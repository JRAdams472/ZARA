//! `zara-migrate` — applies Zara's three migration sets (ADR-0002).
//!
//! Order matters: `bootstrap` (roles/schemas/grants, admin role) →
//! `control` (control-plane tables, migrate role) → `env` ×N
//! (identical DDL into every `zara_{env}` schema).

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;
use sqlx::{Connection, PgConnection};
use zara_migrate as zm;

#[derive(Parser)]
#[command(version, about = "Zara data-plane migration runner")]
struct Args {
    /// Admin (superuser) DSN — used for the bootstrap set (role/schema
    /// creation) and as the fallback DSN for the remaining sets.
    #[arg(long, env = "DATABASE_URL")]
    admin_url: String,

    /// DSN for the migrate role that owns schema objects. Defaults to
    /// --admin-url — but run as `zara_migrate` so FORCE-RLS applies to the
    /// owner (a superuser bypasses RLS regardless).
    #[arg(long, env = "MIGRATE_DATABASE_URL")]
    migrate_url: Option<String>,

    /// Environments to apply the env set to (comma-separated).
    #[arg(long, env = "ZARA_ENVS", value_delimiter = ',', default_values_t = zm::DEFAULT_ENVS.iter().map(|s| s.to_string()))]
    envs: Vec<String>,

    /// Migrations root containing bootstrap/ control/ env/.
    #[arg(long, env = "ZARA_MIGRATIONS_DIR", default_value = "migrations")]
    migrations_dir: PathBuf,

    /// After bootstrap, `ALTER ROLE ... PASSWORD` from the ZARA_*_PASSWORD
    /// env vars (see PASSWORD_ROLES). Required for the roles to log in.
    #[arg(long)]
    set_role_passwords: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // 1. bootstrap — admin role; creates roles, schemas, grants.
    let bootstrap = zm::set_dir(&args.migrations_dir, zm::BOOTSTRAP_SET)?;
    let mut admin = PgConnection::connect(&args.admin_url)
        .await
        .context("connecting with admin DSN")?;
    let n = zm::apply_set(&mut admin, &bootstrap).await?;
    eprintln!("bootstrap: {n} migration(s) applied");

    if args.set_role_passwords {
        let updated = zm::set_role_passwords(&mut admin, |v| std::env::var(v).ok()).await?;
        eprintln!("role passwords set: {}", updated.join(", "));
    }

    // 2. control — migrate role owns control-plane objects; search_path pins
    // the _sqlx_migrations ledger into zara_control rather than public.
    let migrate_url = args.migrate_url.unwrap_or_else(|| args.admin_url.clone());
    let control = zm::set_dir(&args.migrations_dir, zm::CONTROL_SET)?;
    let n = zm::apply_env_schema(&migrate_url, "zara_control", &control).await?;
    eprintln!("control: {n} migration(s) applied");

    // 3. env — identical DDL into every zara_{env} schema.
    let schemas = zm::parse_envs(&args.envs)?;
    let env_dir = zm::set_dir(&args.migrations_dir, zm::ENV_SET)?;
    for schema in &schemas {
        let n = zm::apply_env_schema(&migrate_url, schema, &env_dir).await?;
        eprintln!("env {schema}: {n} migration(s) applied");
    }

    Ok(())
}
