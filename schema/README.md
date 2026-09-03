# Atlas contract format

Atlas schemas use a small internal contract format. It is not a complete JSON
Schema implementation.

The validator supports these rule keys:

- `type` for `object`, `array`, `string`, `integer`, `number`, `boolean`, and
  `null`. Nullable values use an array, for example `["string", "null"]`.
- `required` for object fields that must be present.
- `properties` for object field rules.
- `additional_properties` to close an object when set to `false`.
- `items` for array element rules.
- `enum` for permitted literal values.
- `min_length` and `max_length` for string bounds.
- `minimum` for numeric lower bounds.

Catalog schema files contain a dataset name and the contract for each record.
Documents add the `schema_version`, `dataset`, and `records` wrapper that the
validator checks before applying the record contract.
