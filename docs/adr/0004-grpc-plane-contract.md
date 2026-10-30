# ADR 0004: gRPC Node→Rust contract

**Status:** Accepted (locked — MPE-113 megaplan)

## Decision

The management plane drives the execution engine over **internal gRPC**:
snapshot publication, cache invalidation / hot reload, and health.
Consumers evaluate over the engine's **REST** surface
(`POST /api/evaluate`) directly — the management plane is not on the
eval hot path.

## Consequences

Proto definitions live in the repo (`proto/`, created at Z4) and are
the contract of record; generated code is committed per each plane's
toolchain. The gRPC hop is authenticated (service JWT, client
credentials) and TLS 1.3 like every other hop. Promotion publish =
management plane writes the snapshot row, then calls `PublishSnapshot`
on the engine so its hot cache converges without a restart; the engine
must also self-heal by re-reading snapshots on an interval in case a
publish call is missed. Rejected: REST for control calls (gRPC's typed
contract + streaming fit better and match the ticket); engine polling
only (slow promotion propagation).
