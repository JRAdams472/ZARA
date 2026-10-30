//! Test-only signing material shared by integration tests. The RSA key
//! exists purely to exercise the validator — it guards nothing and must
//! never be configured as a real issuer.

#![allow(dead_code)]

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde_json::{json, Map, Value};

pub const ISSUER: &str = "https://test-issuer.invalid";
pub const AUDIENCE: &str = "zara-engine";
pub const KID: &str = "test-1";

/// Seeded demo tenants (seed/001_demo_tenants.sql).
pub const ACME: &str = "aa5ce000-0000-4000-8000-0000000000ac";
pub const NORTHSTAR: &str = "bb0215a0-0000-4000-8000-0000000000b2";

pub const PRIVATE_KEY_PEM: &str = "-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCRW5Q22sSuCS4N
xd1CcXFJH4Ra4xB47a74Nmbeol572c8lt2b3JezoZbEXKjo56xxta4dD7f2qSKyn
pFiwIyJvqYdy3oly85ofa0lnaKORUT+nxyyCqD7mp15k2D6krzpbJu7tbi6D30tp
kVYCDqoCId71GLJYuX3OoabYUlTCIWrHX/q+yUnQVtmh6GVGgrEMH9IN49A0VviY
8TuPRvMmjlvMpPwWGsftnweCouEOxiXzyo7tbzTBAfC2hJkphFsFJJLdYEvStX75
fB3B+wzVUM4Oj5CT/D40rtXJvYeeCBKE5XPOSp5UbOxrMcKtTb5cnEqyh4WUTHYh
vQ492fE3AgMBAAECggEAPE01q5wOQ/Ti+iu/orTVPnSov9u7Fa/lCmvnOS067T5q
xUbUnGtLYQ3u7aFDDowO+wXE09WDioUju1hewpOQ0aoO2wSfGOUeZzJm/VNXqA2A
zuW9/WY20hFVA5kCQ+e92drI/A7dlS+pZV45xBi5RrEugZeBRXWOT46YXN2q8+2w
5ZbORiag5wUmIuA3hk7PdDDmXJ4CLFTazZ6xv//UvqJqSPNr3JCpQJc04UxY3Goy
o6TP0i7fnByjFzRvCD2QbTYmgpWz7tkmzS09ppzsGsupWPKrHFbZU9aM+QxGTFre
ORT7IEqS9VjEPP1Pb5YckbFmssNqbHB/I5MddYhNIQKBgQDIktMcbHPLI/YA3sLU
n+jZQ24pLiVYNg2iCp5VO7qd35374DtkuDjhzpukmRI1CCKqRqdAIkLqcsH8CXqb
PZv/EHADuTV+Gcv9x3juTca+hX44WRax9bm7OHfWyejJzq/ytHst6qhtSzh2jn6k
UIDSwdQNtvuctJEst5gZijaQ6wKBgQC5hp9JioUJCL98El5zxtGuee+Xpb0MhE2Q
iOLbMLHDiHtOrfM06fyCkHOvg/mB34PRHiv5uIqyOrM20JkXwKBgrOTiXv7wew7j
oFQ2Aj9aetYy/JS9e8dy4KVrGQ3O3ZuX4updfgni/2CWWW1ciWrXuFRhjW+JqVr8
FyZqPnMt5QKBgQCc7/1NXTKRPTcMYUCS+/hGn3M/t4Ky7cBnDOXsjQqs4r6LyVzP
pzGixXWVKcxMQGxXTWcqUGSJa3eLTKNpeqBnyCXNVAqd+3NYw85EsAiVJICpeFPA
tSM5caqbHmsOFLIpNry3JcfZlKS+ZyqCSRczUUQp4wYnDEYXdiQFv9aINwKBgD2A
F/uL9K/a+4cIm9DrXoTlHPx7T6D/lqrMBc+9Y6A69Q1O8qley3sIoaDUMfjQfGTt
CIzelPOiK9iG68kI7OE/TxyPexmC4ZupgWDp+9Blme4K9s+dYa9+Mre+9WnW4oZG
DYTyjBp4p68PdAZR814RV7+C4C+VOXkJv41GqG3VAoGBAIPMC4qtU48IS/bQ0Un1
rodNg2xIBFB8+7FBZ47M4xUdKSQozBF8LNcZ9GwBWrxd3fC+D5iNhig4jAxv7H9p
wlg1we4gZAJpAPiYFAyvm8/D0mLdiYxYbhRItjd7DQrLlCs3KNMMIQDJlphxWGIF
Wz7MWYmbSAY5N+HwOIKQoJMa
-----END PRIVATE KEY-----";

pub const JWKS_JSON: &str = r#"{"keys":[{"kty":"RSA","kid":"test-1","use":"sig","alg":"RS256","n":"kVuUNtrErgkuDcXdQnFxSR-EWuMQeO2u-DZm3qJee9nPJbdm9yXs6GWxFyo6OescbWuHQ-39qkisp6RYsCMib6mHct6JcvOaH2tJZ2ijkVE_p8csgqg-5qdeZNg-pK86Wybu7W4ug99LaZFWAg6qAiHe9RiyWLl9zqGm2FJUwiFqx1_6vslJ0FbZoehlRoKxDB_SDePQNFb4mPE7j0bzJo5bzKT8FhrH7Z8HgqLhDsYl88qO7W80wQHwtoSZKYRbBSSS3WBL0rV--XwdwfsM1VDODo-Qk_w-NK7Vyb2HnggShOVzzkqeVGzsazHCrU2-XJxKsoeFlEx2Ib0OPdnxNw","e":"AQAB"}]}"#;

/// Mint a test token for `tenant_id` with the given env permissions.
/// `extra` claims merge over the defaults (iss/aud/sub/exp/iat/ttl).
pub fn mint(tenant_id: &str, envs: &[&str], ttl_secs: i64, extra: &[(String, Value)]) -> String {
    let now = jsonwebtoken::get_current_timestamp() as i64;
    let mut claims = Map::from_iter([
        ("iss".into(), ISSUER.into()),
        ("aud".into(), AUDIENCE.into()),
        ("sub".into(), "test-subject".into()),
        ("tenant_id".into(), tenant_id.into()),
        (
            "permitted_environments".into(),
            json!(envs.iter().collect::<Vec<_>>()),
        ),
        ("exp".into(), (now + ttl_secs).into()),
        ("iat".into(), now.into()),
    ]);
    for (k, v) in extra {
        claims.insert(k.clone(), v.clone());
    }
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some(KID.into());
    encode(
        &header,
        &Value::Object(claims),
        &EncodingKey::from_rsa_pem(PRIVATE_KEY_PEM.as_bytes()).expect("test key parses"),
    )
    .expect("test token mints")
}

/// An HS256 token — the alg-confusion case. Claims are irrelevant: the
/// validator must reject at the header parse.
pub fn mint_hs256() -> String {
    let now = jsonwebtoken::get_current_timestamp() as i64;
    let claims = json!({
        "iss": ISSUER, "aud": AUDIENCE, "sub": "test-subject",
        "tenant_id": ACME, "permitted_environments": ["dev"],
        "exp": now + 3600, "iat": now,
    });
    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some(KID.into());
    encode(&header, &claims, &EncodingKey::from_secret(b"whatever")).expect("hs token mints")
}
