# Development-data handoff

Imported MCP tools that still store request-definition version 1 are invalid
under the current canonical model. While the product remains `PRE_PRODUCTION`,
those rows are disposable development data.

This change does **not** reseed or replace any database. Existing development
servers keep their current tools until the owner explicitly reseeds
(`bun db:seed`) or re-imports the OpenAPI document in MCP Studio.

After an authorized reseed or reimport:

- New imported tools use request-definition version 2, array agent inputs, and
  query `form` serialization where the document declares it.
- Genuinely unsupported operations stay blocked with the same diagnostics.
- Runtime discovery and execution continue to read only the immutable published
  revision; a reimport updates the draft until the owner publishes.
