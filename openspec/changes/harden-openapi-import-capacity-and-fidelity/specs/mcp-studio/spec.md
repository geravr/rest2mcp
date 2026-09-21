## ADDED Requirements

### Requirement: Canonical authoring preserves dynamic arrays and request serialization

The canonical typed request definition SHALL represent array-valued agent inputs separately from fixed JSON array templates. It SHALL preserve supported primitive item constraints, bounded array constraints, optionality, and supported query serialization through save, reopen, compile preview, publication, and playground execution. Unsupported serialization SHALL fail compilation with a location-aware issue rather than falling back to object stringification.

#### Scenario: Array input survives save and reopen

- **WHEN** the owner saves an array-valued input with string item constraints and bounds
- **THEN** Studio reloads the same array type, item constraints, bounds, stable id, and request bindings

#### Scenario: Repeated query serialization is previewed

- **WHEN** a query entry binds an array input with form serialization and explode enabled
- **THEN** compile preview shows one encoded query entry per supplied array item

#### Scenario: Delimited query serialization is previewed

- **WHEN** a query entry binds an array input with form serialization and explode disabled
- **THEN** compile preview shows one comma-delimited encoded query value

#### Scenario: Optional structured body field is omitted

- **WHEN** an optional object or array body field is bound to an absent structured input
- **THEN** compile preview omits the complete field instead of emitting an empty placeholder or one-element template

#### Scenario: Serialization requires an array input

- **WHEN** form-array serialization is attached to a scalar or structured object input
- **THEN** compilation returns a blocking issue at that query entry

#### Scenario: Unsupported query style is rejected

- **WHEN** a query entry requests a serialization style not represented by the canonical model
- **THEN** the strict typed command or compiler rejects it and preserves the previous stored definition
