//! Migration runner core for Zara's data plane (ADR-0002).
//!
//! Three append-only migration sets under `migrations/`:
//!
//! | set | dir | applies to | runs |
//! |---|---|---|---|
//! | bootstrap | `bootstrap/` | cluster | once, admin role — roles, schemas, grants |
//! | control | `control/` | `zara_control` schema | once, migrate role |
//! | env | `env/` | each `zara_{env}` schema | once per environment |
//!
//! Each set uses sqlx's own `_sqlx_migrations` ledger — the env set therefore
//! leaves an identical ledger inside every environment schema, which the
//! isolation suite diffs to prove uniform application.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use sqlx::{Connection, Executor, PgConnection};

/// Migration set directory names, relative to the migrations root.
pub const BOOTSTRAP_SET: &str = "bootstrap";
pub const CONTROL_SET: &str = "control";
pub const ENV_SET: &str = "env";

/// Environment slugs in promotion order (ADR-0002, MPE-113 §3.1).
pub const DEFAULT_ENVS: &[&str] = &["dev", "qa", "uat", "prod"];

/// Roles whose passwords are provisioned out-of-band via `--set-role-passwords`
/// — never written into SQL files. Maps role name → env var holding its secret.
pub const PASSWORD_ROLES: &[(&str, &str)] = &[
    ("zara_migrate", "ZARA_MIGRATE_PASSWORD"),
    ("zara_app_dev", "ZARA_APP_DEV_PASSWORD"),
    ("zara_app_qa", "ZARA_APP_QA_PASSWORD"),
    ("zara_app_uat", "ZARA_APP_UAT_PASSWORD"),
    ("zara_app_prod", "ZARA_APP_PROD_PASSWORD"),
    ("zara_promote", "ZARA_PROMOTE_PASSWORD"),
    ("zara_engine", "ZARA_ENGINE_PASSWORD"),
    ("zara_mgmt", "ZARA_MGMT_PASSWORD"),
];

/// Validate an environment slug and return its schema name.
pub fn env_schema(env: &str) -> Result<String> {
    match env {
        "dev" | "qa" | "uat" | "prod" => Ok(format!("zara_{env}")),
        other => bail!("unknown environment {other:?} — expected one of {DEFAULT_ENVS:?}"),
    }
}

/// Resolve a migration set directory under the migrations root.
pub fn set_dir(root: &Path, set: &str) -> Result<PathBuf> {
    let dir = root.join(set);
    if dir.is_dir() {
        Ok(dir)
    } else {
        bail!("migration set dir {dir:?} does not exist")
    }
}

/// Parse a comma-separated `--envs` value into validated schema names.
pub fn parse_envs(envs: &[String]) -> Result<Vec<String>> {
    let list = if envs.is_empty() {
        DEFAULT_ENVS.iter().map(|s| s.to_string()).collect()
    } else {
        envs.to_vec()
    };
    list.iter().map(|e| env_schema(e)).collect()
}

/// Run a migration set on an existing connection (search_path already set).
/// Returns the number of migrations recorded in the set's ledger afterwards.
pub async fn apply_set(conn: &mut PgConnection, dir: &Path) -> Result<i64> {
    let migrator = sqlx::migrate::Migrator::new(dir)
        .await
        .with_context(|| format!("loading migrations from {dir:?}"))?;
    migrator
        .run(&mut *conn)
        .await
        .with_context(|| format!("applying migrations from {dir:?}"))?;
    let (applied,): (i64,) = sqlx::query_as("SELECT count(*) FROM _sqlx_migrations")
        .fetch_one(conn)
        .await
        .context("reading _sqlx_migrations ledger")?;
    Ok(applied)
}

/// Apply the env set to one environment schema on its own connection.
/// `SET search_path` scopes both the `_sqlx_migrations` ledger and the
/// schema-agnostic DDL into `<schema>`.
pub async fn apply_env_schema(dsn: &str, schema: &str, dir: &Path) -> Result<i64> {
    let mut conn = PgConnection::connect(dsn)
        .await
        .with_context(|| format!("connecting for env schema {schema}"))?;
    conn.execute(format!("SET search_path TO {schema}").as_str())
        .await
        .with_context(|| format!("setting search_path to {schema}"))?;
    apply_set(&mut conn, dir).await
}

/// Apply an arbitrary set over a single connection.
pub async fn apply_on(dsn: &str, dir: &Path) -> Result<i64> {
    let mut conn = PgConnection::connect(dsn).await?;
    apply_set(&mut conn, dir).await
}

/// Provision role passwords from env vars — the only path that lets secrets
/// reach the database; nothing secret ever lives in a `.sql` file.
/// Returns the roles actually updated (env var set and non-empty).
pub async fn set_role_passwords(
    conn: &mut PgConnection,
    getenv: impl Fn(&str) -> Option<String>,
) -> Result<Vec<String>> {
    let mut updated = Vec::new();
    for (role, var) in PASSWORD_ROLES {
        let Some(pw) = getenv(var) else { continue };
        if pw.is_empty() {
            continue;
        }
        // ALTER ROLE is a utility statement — parameters aren't bindable,
        // so the password is inlined with single quotes doubled (the only
        // character needing escape inside a quoted literal). The role name
        // itself comes from the hard-coded PASSWORD_ROLES allowlist.
        let escaped = pw.replace('\'', "''");
        conn.execute(format!("ALTER ROLE {role} WITH PASSWORD '{escaped}'").as_str())
            .await
            .with_context(|| format!("setting password for role {role}"))?;
        updated.push((*role).to_string());
    }
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_schema_accepts_known_envs() {
        for env in DEFAULT_ENVS {
            assert_eq!(env_schema(env).unwrap(), format!("zara_{env}"));
        }
    }

    #[test]
    fn env_schema_rejects_unknown() {
        assert!(env_schema("production").is_err());
        assert!(env_schema("dev; DROP TABLE x").is_err());
        assert!(env_schema("").is_err());
    }

    #[test]
    fn parse_envs_defaults_to_all() {
        let schemas = parse_envs(&[]).unwrap();
        assert_eq!(
            schemas,
            vec!["zara_dev", "zara_qa", "zara_uat", "zara_prod"]
        );
    }

    #[test]
    fn parse_envs_respects_subset() {
        let schemas = parse_envs(&["qa".to_string(), "prod".to_string()]).unwrap();
        assert_eq!(schemas, vec!["zara_qa", "zara_prod"]);
    }

    #[test]
    fn parse_envs_rejects_unknown() {
        assert!(parse_envs(&["staging".to_string()]).is_err());
    }

    #[test]
    fn set_dir_requires_existing_dir() {
        assert!(set_dir(Path::new("/nonexistent-xyz"), "env").is_err());
        let tmp = std::env::temp_dir().join("zara-migrate-test-env");
        std::fs::create_dir_all(tmp.join("env")).unwrap();
        assert!(set_dir(&tmp, "env").is_ok());
        assert!(set_dir(&tmp, "control").is_err());
    }

    #[test]
    fn password_roles_are_allowlisted() {
        for (role, var) in PASSWORD_ROLES {
            assert!(role.starts_with("zara_"));
            assert!(var.ends_with("_PASSWORD"));
        }
    }
}
