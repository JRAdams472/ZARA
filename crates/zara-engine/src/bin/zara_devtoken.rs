//! `zara-devtoken` — mints development/benchmark JWTs for the engine.
//!
//! Generates a FRESH ephemeral RSA-2048 keypair every run (unless
//! `--key-out`/`--key-in` reuses one), writes the public half as a JWKS
//! document for `ZARA_JWKS_JSON`/`ZARA_JWKS_FILE`, and prints a signed
//! token carrying `tenant_id` + `permitted_environments`. Keys are
//! generated at runtime and never committed — dev/test only, never prod.
//!
//!   zara-devtoken --tenant-id <uuid> --envs dev,qa --jwks-out .devkeys/jwks.json

use std::path::PathBuf;

use anyhow::{Context, Result};
use base64::Engine;
use clap::Parser;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use rsa::pkcs8::{DecodePrivateKey, EncodePrivateKey, LineEnding};
use rsa::traits::PublicKeyParts;
use serde_json::json;
use uuid::Uuid;

#[derive(Parser)]
#[command(version, about = "Mint ephemeral-key dev JWTs for zara-engine")]
struct Args {
    /// Tenant UUID the token is scoped to (`tenant_id` claim).
    #[arg(long)]
    tenant_id: Uuid,

    /// Environments the token may evaluate (comma-separated dev|qa|uat|prod).
    #[arg(long, value_delimiter = ',', default_value = "dev")]
    envs: Vec<String>,

    /// Token subject.
    #[arg(long, default_value = "zara-dev")]
    sub: String,

    /// Issuer claim — must match OIDC_ISSUER when the service pins one.
    #[arg(long, default_value = "zara-devtoken")]
    iss: String,

    /// Audience claim — must match OIDC_AUDIENCE.
    #[arg(long, default_value = "zara-engine")]
    aud: String,

    /// Token TTL in seconds.
    #[arg(long, default_value_t = 3600)]
    ttl: i64,

    /// Write the public JWKS here (point ZARA_JWKS_FILE at it).
    #[arg(long)]
    jwks_out: Option<PathBuf>,

    /// Also write the private key PEM here (reuse across runs with --key-in).
    #[arg(long)]
    key_out: Option<PathBuf>,

    /// Reuse an existing private key PEM instead of generating one.
    #[arg(long)]
    key_in: Option<PathBuf>,

    /// `kid` stamped on the token + JWKS.
    #[arg(long, default_value = "dev-1")]
    kid: String,
}

fn main() -> Result<()> {
    let args = Args::parse();

    let (pem, n_b64, e_b64) = match &args.key_in {
        Some(path) => {
            let pem = std::fs::read_to_string(path)
                .with_context(|| format!("reading {}", path.display()))?;
            let key = rsa::RsaPrivateKey::from_pkcs8_pem(&pem).context("parsing --key-in PEM")?;
            let pubk = key.to_public_key();
            (
                pem,
                b64(&pubk.n().to_bytes_be()),
                b64(&pubk.e().to_bytes_be()),
            )
        }
        None => {
            let mut rng = rand::rngs::OsRng;
            let key = rsa::RsaPrivateKey::new(&mut rng, 2048).context("generating RSA key")?;
            let pubk = key.to_public_key();
            let pem = key
                .to_pkcs8_pem(LineEnding::LF)
                .context("encoding private key")?
                .to_string();
            (
                pem,
                b64(&pubk.n().to_bytes_be()),
                b64(&pubk.e().to_bytes_be()),
            )
        }
    };

    for e in &args.envs {
        anyhow::ensure!(
            matches!(e.as_str(), "dev" | "qa" | "uat" | "prod"),
            "unknown env {e:?} — expected dev|qa|uat|prod"
        );
    }

    let now = jsonwebtoken::get_current_timestamp() as i64;
    let claims = json!({
        "iss": args.iss,
        "aud": args.aud,
        "sub": args.sub,
        "tenant_id": args.tenant_id,
        "permitted_environments": args.envs,
        "iat": now,
        "exp": now + args.ttl,
    });
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some(args.kid.clone());
    let token = encode(
        &header,
        &claims,
        &EncodingKey::from_rsa_pem(pem.as_bytes()).context("private key for signing")?,
    )
    .context("minting token")?;

    let jwks = json!({"keys": [{
        "kty": "RSA", "kid": args.kid, "use": "sig", "alg": "RS256",
        "n": n_b64, "e": e_b64,
    }]})
    .to_string();

    if let Some(path) = &args.jwks_out {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
        }
        std::fs::write(path, &jwks).with_context(|| format!("writing {}", path.display()))?;
        eprintln!("jwks → {}", path.display());
    }
    if let Some(path) = &args.key_out {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
        }
        std::fs::write(path, &pem).with_context(|| format!("writing {}", path.display()))?;
        eprintln!("private key → {} (keep out of git)", path.display());
    }

    println!("{token}");
    if args.jwks_out.is_none() {
        eprintln!("jwks: {jwks}");
    }
    Ok(())
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}
