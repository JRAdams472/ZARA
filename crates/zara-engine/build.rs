//! Codegen for the committed proto contract (ADR-0004). Emits the Rust
//! stubs into `src/grpc/gen/` — generated code is committed to the repo
//! and regenerated on every build, so the committed copy can never drift
//! from proto/zara/engine/v1/engine.proto.

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=../../proto/zara/engine/v1/engine.proto");
    std::fs::create_dir_all("src/grpc/gen")?;
    std::env::set_var("PROTOC", protoc_bin_vendored::protoc_bin_path()?);
    tonic_build::configure()
        .build_server(true)
        .build_client(true)
        .out_dir("src/grpc/gen")
        .compile_protos(
            &["../../proto/zara/engine/v1/engine.proto"],
            &["../../proto"],
        )?;
    Ok(())
}
