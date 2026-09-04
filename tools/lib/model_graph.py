from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from math import ceil, isfinite
from typing import Callable


Number = int | float


@dataclass(frozen=True)
class GraphProblem:
    path: str
    code: str
    message: str


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _finite_number(value: object, label: str) -> Number:
    if not _is_number(value) or not isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    return value


def _add(values: list[Number]) -> Number:
    return sum(values)


def _mul(values: list[Number]) -> Number:
    result: Number = 1
    for value in values:
        result *= value
    return result


def _sub(values: list[Number]) -> Number:
    return values[0] - values[1]


def _div(values: list[Number]) -> Number:
    if values[1] == 0:
        raise ValueError("division by zero")
    return values[0] / values[1]


def _ceil_div(values: list[Number]) -> Number:
    if values[1] == 0:
        raise ValueError("division by zero")
    return ceil(values[0] / values[1])


_OPERATIONS: dict[str, tuple[int | None, Callable[[list[Number]], Number]]] = {
    "add": (2, _add),
    "sub": (2, _sub),
    "mul": (2, _mul),
    "div": (2, _div),
    "ceil_div": (2, _ceil_div),
}


def evaluate_expression(expression: object, bindings: Mapping[str, Number]) -> Number:
    """Evaluate the deliberately small, data-only expression language."""
    if _is_number(expression):
        return _finite_number(expression, "expression")
    if not isinstance(expression, Mapping):
        raise ValueError("expression must be a finite number or expression object")

    keys = set(expression)
    if keys == {"symbol"}:
        symbol = expression["symbol"]
        if not isinstance(symbol, str) or not symbol:
            raise ValueError("symbol must be a non-empty string")
        if symbol not in bindings:
            raise ValueError(f"unknown symbol: {symbol}")
        return _finite_number(bindings[symbol], f"binding {symbol}")

    if keys != {"op", "args"}:
        raise ValueError("expression object must be a symbol or op/args pair")
    operation = expression["op"]
    args = expression["args"]
    if not isinstance(operation, str) or operation not in _OPERATIONS:
        raise ValueError("unknown expression operation")
    if not isinstance(args, list):
        raise ValueError("expression args must be an array")
    arity, dispatch = _OPERATIONS[operation]
    if arity is not None and len(args) < arity:
        raise ValueError(f"{operation} requires at least {arity} arguments")
    if operation in {"sub", "div", "ceil_div"} and len(args) != 2:
        raise ValueError(f"{operation} requires exactly two arguments")
    result = dispatch([evaluate_expression(arg, bindings) for arg in args])
    return _finite_number(result, "expression result")


def _symbol_references(expression: object) -> set[str]:
    if _is_number(expression):
        return set()
    if not isinstance(expression, Mapping):
        raise ValueError("expression must be a finite number or expression object")
    if set(expression) == {"symbol"}:
        symbol = expression.get("symbol")
        if not isinstance(symbol, str) or not symbol:
            raise ValueError("symbol must be a non-empty string")
        return {symbol}
    if set(expression) != {"op", "args"}:
        raise ValueError("expression object must be a symbol or op/args pair")
    operation = expression.get("op")
    args = expression.get("args")
    if not isinstance(operation, str) or operation not in _OPERATIONS or not isinstance(args, list):
        raise ValueError("invalid expression operation")
    arity = _OPERATIONS[operation][0]
    if len(args) < arity or (operation in {"sub", "div", "ceil_div"} and len(args) != 2):
        raise ValueError("invalid expression arity")
    result: set[str] = set()
    for arg in args:
        result.update(_symbol_references(arg))
    return result


def resolve_symbols(
    symbols: Sequence[Mapping[str, object]], overrides: Mapping[str, Number] | None = None
) -> dict[str, Number]:
    """Resolve global base and derived symbols without allowing implicit scopes."""
    entries: dict[str, Mapping[str, object]] = {}
    for item in symbols:
        symbol = item.get("symbol")
        if not isinstance(symbol, str) or not symbol:
            raise ValueError("symbol must be a non-empty string")
        if symbol in entries:
            raise ValueError(f"duplicate symbol: {symbol}")
        entries[symbol] = item

    supplied = overrides or {}
    for symbol, value in supplied.items():
        item = entries.get(symbol)
        if item is None or item.get("editable") is not True:
            raise ValueError(f"override is not editable: {symbol}")
        _finite_number(value, f"override {symbol}")

    resolved: dict[str, Number] = {}
    resolving: list[str] = []

    def resolve(symbol: str) -> Number:
        if symbol in resolved:
            return resolved[symbol]
        if symbol not in entries:
            raise ValueError(f"unknown symbol: {symbol}")
        if symbol in resolving:
            start = resolving.index(symbol)
            raise ValueError("symbol cycle: " + " -> ".join(resolving[start:] + [symbol]))
        item = entries[symbol]
        resolving.append(symbol)
        try:
            expression = item.get("expression")
            default = item.get("default")
            if expression is None:
                if default is None:
                    raise ValueError(f"base symbol has no default: {symbol}")
                value = supplied.get(symbol, default)
                value = _finite_number(value, f"symbol {symbol}")
                minimum = item.get("minimum")
                maximum = item.get("maximum")
                if not _is_number(minimum) or not _is_number(maximum):
                    raise ValueError(f"base symbol bounds are invalid: {symbol}")
                if value < minimum or value > maximum:
                    raise ValueError(f"symbol override is out of bounds: {symbol}")
            else:
                if default is not None or item.get("editable") is True:
                    raise ValueError(f"derived symbol declaration is invalid: {symbol}")
                references = sorted(_symbol_references(expression))
                value = evaluate_expression(expression, {name: resolve(name) for name in references})
            resolved[symbol] = value
            return value
        finally:
            resolving.pop()

    for symbol in entries:
        resolve(symbol)
    return resolved


def _mapping_list(value: object) -> list[Mapping[str, object]]:
    return [item for item in value if isinstance(item, Mapping)] if isinstance(value, list) else []


def _ids(
    items: object, field: str, path: str, problems: list[GraphProblem]
) -> dict[str, Mapping[str, object]]:
    result: dict[str, Mapping[str, object]] = {}
    for index, item in enumerate(_mapping_list(items)):
        value = item.get(field)
        if not isinstance(value, str) or not value:
            problems.append(GraphProblem(f"{path}[{index}].{field}", "invalid_id", "ID must be a non-empty string"))
        elif value in result:
            problems.append(GraphProblem(f"{path}[{index}].{field}", "duplicate", "ID must be unique in its scope"))
        else:
            result[value] = item
    return result


def _problem_value(
    problems: list[GraphProblem], path: str, thunk: Callable[[], object]
) -> object | None:
    try:
        return thunk()
    except ValueError as error:
        problems.append(GraphProblem(path, "invalid_expression", str(error)))
        return None


def _validate_bindings(
    bindings: object,
    expected: object,
    environment: Mapping[str, Number],
    path: str,
    problems: list[GraphProblem],
) -> dict[str, Number]:
    expected_names = expected if isinstance(expected, list) else []
    expected_set = {name for name in expected_names if isinstance(name, str) and name}
    actual: dict[str, Mapping[str, object]] = {}
    for index, binding in enumerate(_mapping_list(bindings)):
        name = binding.get("symbol")
        binding_path = f"{path}[{index}]"
        if not isinstance(name, str) or not name:
            problems.append(GraphProblem(f"{binding_path}.symbol", "invalid_binding", "binding symbol must be non-empty"))
        elif name in actual:
            problems.append(GraphProblem(f"{binding_path}.symbol", "duplicate", "binding symbol must be unique"))
        else:
            actual[name] = binding
    for name in sorted(expected_set - set(actual)):
        problems.append(GraphProblem(path, "missing_binding", f"missing binding for {name}"))
    for name in sorted(set(actual) - expected_set):
        problems.append(GraphProblem(path, "extra_binding", f"binding is not declared: {name}"))
    values: dict[str, Number] = {}
    for name in expected_names:
        binding = actual.get(name) if isinstance(name, str) else None
        if binding is None:
            continue
        value = _problem_value(
            problems, f"{path}[{list(actual).index(name)}].expression",
            lambda binding=binding: evaluate_expression(binding.get("expression"), environment),
        )
        if _is_number(value):
            values[name] = value
    return values


def _require_count(
    expression: object, environment: Mapping[str, Number], path: str, problems: list[GraphProblem]
) -> Number | None:
    value = _problem_value(problems, path, lambda: evaluate_expression(expression, environment))
    if not _is_number(value):
        return None
    if value < 0 or int(value) != value:
        problems.append(GraphProblem(path, "invalid_count", "shape and repeat counts must be non-negative integers"))
        return None
    return value


def _validate_axes(
    tensors: object, environment: Mapping[str, Number], path: str, problems: list[GraphProblem]
) -> None:
    for tensor_index, tensor in enumerate(_mapping_list(tensors)):
        axes = tensor.get("axes")
        seen: set[str] = set()
        for axis_index, axis in enumerate(_mapping_list(axes)):
            axis_name = axis.get("axis")
            axis_path = f"{path}[{tensor_index}].axes[{axis_index}]"
            if not isinstance(axis_name, str) or not axis_name:
                problems.append(GraphProblem(f"{axis_path}.axis", "invalid_axis", "axis must be non-empty"))
            elif axis_name in seen:
                problems.append(GraphProblem(f"{axis_path}.axis", "duplicate", "tensor axis must be unique"))
            else:
                seen.add(axis_name)
            _require_count(axis.get("expression"), environment, f"{axis_path}.expression", problems)


def _binding_map(bindings: object) -> dict[str, Mapping[str, object]]:
    return {
        item["port"]: item
        for item in _mapping_list(bindings)
        if isinstance(item.get("port"), str)
    }


def _component_port_map(
    bindings: object,
    path: str,
    problems: list[GraphProblem],
) -> dict[str, Mapping[str, object]]:
    result: dict[str, Mapping[str, object]] = {}
    for index, binding in enumerate(_mapping_list(bindings)):
        port = binding.get("port")
        if not isinstance(port, str):
            continue
        if port in result:
            problems.append(
                GraphProblem(
                    f"{path}[{index}].port",
                    "duplicate",
                    "component port binding must be unique",
                )
            )
        else:
            result[port] = binding
    return result


def _concrete_shape(
    tensor: Mapping[str, object] | None, environment: Mapping[str, Number]
) -> tuple[int, ...] | None:
    if tensor is None:
        return None
    try:
        values = [
            evaluate_expression(axis.get("expression"), environment)
            for axis in _mapping_list(tensor.get("axes"))
        ]
    except ValueError:
        return None
    if any(value < 0 or int(value) != value for value in values):
        return None
    return tuple(int(value) for value in values)


def _canonical_number(value: Number) -> tuple[str, Number]:
    value = _finite_number(value, "expression")
    if int(value) == value:
        value = int(value)
    return ("number", value)


def _canonical_expression(
    expression: object,
    substitutions: Mapping[str, object] | None = None,
) -> object:
    if _is_number(expression):
        return _canonical_number(expression)
    if not isinstance(expression, Mapping):
        raise ValueError("expression must be a finite number or expression object")
    if set(expression) == {"symbol"}:
        symbol = expression.get("symbol")
        if not isinstance(symbol, str) or not symbol:
            raise ValueError("symbol must be a non-empty string")
        if substitutions is not None and symbol in substitutions:
            return _canonical_expression(substitutions[symbol])
        return ("symbol", symbol)
    if set(expression) != {"op", "args"}:
        raise ValueError("expression object must be a symbol or op/args pair")
    operation = expression.get("op")
    args = expression.get("args")
    if not isinstance(operation, str) or operation not in _OPERATIONS:
        raise ValueError("unknown expression operation")
    if not isinstance(args, list):
        raise ValueError("expression args must be an array")
    arity, dispatch = _OPERATIONS[operation]
    if arity is not None and len(args) < arity:
        raise ValueError(f"{operation} requires at least {arity} arguments")
    if operation in {"sub", "div", "ceil_div"} and len(args) != 2:
        raise ValueError(f"{operation} requires exactly two arguments")
    canonical_args = [
        _canonical_expression(arg, substitutions) for arg in args
    ]
    if all(arg[0] == "number" for arg in canonical_args):
        return _canonical_number(dispatch([arg[1] for arg in canonical_args]))
    if operation in {"add", "mul"}:
        flattened = []
        for arg in canonical_args:
            if arg[0] == operation:
                flattened.extend(arg[1])
            else:
                flattened.append(arg)
        numeric = [arg[1] for arg in flattened if arg[0] == "number"]
        symbolic = [arg for arg in flattened if arg[0] != "number"]
        identity = 0 if operation == "add" else 1
        combined = dispatch(numeric) if numeric else identity
        if operation == "mul" and combined == 0:
            return _canonical_number(0)
        if combined != identity or not symbolic:
            symbolic.append(_canonical_number(combined))
        symbolic.sort(key=repr)
        if len(symbolic) == 1:
            return symbolic[0]
        return (operation, tuple(symbolic))
    if operation == "sub" and canonical_args[1] == _canonical_number(0):
        return canonical_args[0]
    if operation in {"div", "ceil_div"} and canonical_args[1] == _canonical_number(1):
        return canonical_args[0]
    return (operation, tuple(canonical_args))


def _symbolic_shape(
    tensor: Mapping[str, object] | None,
    substitutions: Mapping[str, object] | None = None,
) -> tuple[object, ...] | None:
    if tensor is None:
        return None
    try:
        return tuple(
            _canonical_expression(axis.get("expression"), substitutions)
            for axis in _mapping_list(tensor.get("axes"))
        )
    except (ValueError, ZeroDivisionError):
        return None


def _validate_indexed_boundary(
    annotation: Mapping[str, object],
    graph_tensor: Mapping[str, object] | None,
    template_tensor: Mapping[str, object] | None,
    graph_environment: Mapping[str, Number],
    template_environment: Mapping[str, Number],
    repeat: Number | None,
    path: str,
    code: str,
    problems: list[GraphProblem],
) -> None:
    axis_name = annotation.get("axis")
    axes = _mapping_list(graph_tensor.get("axes")) if graph_tensor else []
    axis_names = [axis.get("axis") for axis in axes]
    if axis_name not in axis_names:
        problems.append(
            GraphProblem(
                f"{path}.axis",
                "broken_reference",
                "indexed tensor axis does not resolve",
            )
        )
        return
    aggregate_shape = _concrete_shape(graph_tensor, graph_environment)
    element_shape = _concrete_shape(template_tensor, template_environment)
    if aggregate_shape is None or element_shape is None:
        return
    axis_index = axis_names.index(axis_name)
    if repeat is not None and aggregate_shape[axis_index] != repeat:
        problems.append(
            GraphProblem(
                path,
                code,
                "indexed axis extent must equal the module repeat",
            )
        )
    sliced_shape = aggregate_shape[:axis_index] + aggregate_shape[axis_index + 1 :]
    if sliced_shape != element_shape:
        problems.append(
            GraphProblem(
                path,
                code,
                "indexed aggregate shape must match the template port shape",
            )
        )


def _validate_ports_and_endpoints(
    tensors: object,
    nodes: Mapping[str, Mapping[str, object]],
    node_kind: str,
    valid_inputs: set[str],
    valid_outputs: set[str],
    path: str,
    problems: list[GraphProblem],
    loop_endpoints: Mapping[str, Mapping[str, object]] | None = None,
) -> None:
    tensor_ids = _ids(tensors, "tensor_id", f"{path}.tensors", problems)
    producer_counts: dict[str, int] = {tensor_id: 0 for tensor_id in tensor_ids}
    expected_producers: dict[str, tuple[str, str] | None] = {tensor_id: None for tensor_id in tensor_ids}
    expected_consumers: dict[str, set[tuple[str, str]]] = {tensor_id: set() for tensor_id in tensor_ids}
    for node_id, node in nodes.items():
        for direction, port_name in (("inputs", "input_ports"), ("outputs", "output_ports")):
            bindings = _binding_map(node.get(direction))
            for port, binding in bindings.items():
                tensor_id = binding.get("tensor_id")
                binding_path = f"{path}.{node_kind}s[{node_id}].{direction}.{port}"
                if not isinstance(tensor_id, str) or tensor_id not in tensor_ids:
                    problems.append(GraphProblem(binding_path, "broken_reference", "tensor reference does not resolve"))
                    continue
                if direction == "inputs":
                    expected_consumers[tensor_id].add((node_id, port))
                else:
                    producer_counts[tensor_id] += 1
                    expected_producers[tensor_id] = (node_id, port)
    if loop_endpoints:
        for tensor_id, endpoint in loop_endpoints.items():
            if tensor_id not in tensor_ids:
                problems.append(GraphProblem(f"{path}.loop_carried", "broken_reference", "loop tensor reference does not resolve"))
                continue
            producer = endpoint.get("producer")
            if isinstance(producer, tuple):
                producer_counts[tensor_id] += 1
                expected_producers[tensor_id] = producer
            consumers = endpoint.get("consumers")
            if isinstance(consumers, set):
                expected_consumers[tensor_id].update(consumers)
    for tensor_id, tensor in tensor_ids.items():
        tensor_path = f"{path}.tensors[{tensor_id}]"
        producer = tensor.get("producer")
        consumers = tensor.get("consumers")
        if producer is None:
            if tensor_id not in valid_inputs:
                problems.append(GraphProblem(f"{tensor_path}.producer", "invalid_endpoint", "only declared inputs may have a null producer"))
        elif not isinstance(producer, Mapping):
            problems.append(GraphProblem(f"{tensor_path}.producer", "invalid_endpoint", "producer must be an endpoint"))
        else:
            producer_kind = producer.get("node_kind")
            producer_id = producer.get("node_id")
            producer_port = producer.get("port")
            expected_producer = expected_producers[tensor_id]
            is_node_output = (
                producer_kind == node_kind
                and producer_id in nodes
                and (producer_id, producer_port) == expected_producer
            )
            is_loop_output = (
                producer_kind == "loop"
                and isinstance(expected_producer, tuple)
                and (producer_id, producer_port) == expected_producer
            )
            if not is_node_output and not is_loop_output:
                problems.append(GraphProblem(f"{tensor_path}.producer", "endpoint_mismatch", "producer does not match a node output binding"))
        if producer_counts[tensor_id] > 1:
            problems.append(GraphProblem(f"{tensor_path}.producer", "multiple_producers", "tensor has more than one producer"))
        actual_consumers: set[tuple[str, str]] = set()
        for consumer in _mapping_list(consumers):
            kind = consumer.get("node_kind")
            node_id = consumer.get("node_id")
            port = consumer.get("port")
            if kind == node_kind and node_id in nodes and isinstance(port, str):
                actual_consumers.add((node_id, port))
            elif (
                kind == "loop"
                and isinstance(node_id, str)
                and isinstance(port, str)
                and (node_id, port) in expected_consumers[tensor_id]
            ):
                actual_consumers.add((node_id, port))
            else:
                problems.append(GraphProblem(f"{tensor_path}.consumers", "invalid_endpoint", "consumer endpoint does not resolve"))
        optional_loop_consumer = bool(
            loop_endpoints
            and loop_endpoints.get(tensor_id, {}).get("optional_consumer")
        )
        if not actual_consumers and tensor_id not in valid_outputs and not optional_loop_consumer:
            problems.append(GraphProblem(f"{tensor_path}.consumers", "invalid_endpoint", "only declared outputs may have no consumers"))
        if actual_consumers != expected_consumers[tensor_id] and not (
            not actual_consumers and optional_loop_consumer
        ):
            problems.append(GraphProblem(f"{tensor_path}.consumers", "endpoint_mismatch", "consumers do not match node input bindings"))


def _validate_atomic_template(
    template: Mapping[str, object],
    template_path: str,
    definitions: Mapping[str, Mapping[str, object]],
    problems: list[GraphProblem],
) -> None:
    parameters = template.get("parameters")
    if not isinstance(parameters, list) or len(parameters) != len(set(parameters)):
        problems.append(GraphProblem(f"{template_path}.parameters", "duplicate", "template parameters must be unique"))
    template_environment = {name: 1 for name in parameters if isinstance(name, str)}
    tensors = _ids(template.get("tensors"), "tensor_id", f"{template_path}.tensors", problems)
    operators = _ids(template.get("operators"), "operator_id", f"{template_path}.operators", problems)
    input_ports = _binding_map(template.get("input_ports"))
    output_ports = _binding_map(template.get("output_ports"))
    input_tensor_ids = {
        binding.get("tensor_id")
        for binding in input_ports.values()
        if isinstance(binding.get("tensor_id"), str)
    }
    output_tensor_ids = {
        binding.get("tensor_id")
        for binding in output_ports.values()
        if isinstance(binding.get("tensor_id"), str)
    }
    for port, binding in {**input_ports, **output_ports}.items():
        if binding.get("tensor_id") not in tensors:
            problems.append(GraphProblem(f"{template_path}.ports[{port}]", "broken_reference", "template port tensor does not resolve"))
    _validate_axes(template.get("tensors"), template_environment, f"{template_path}.tensors", problems)
    for operator_id, operator in operators.items():
        operator_path = f"{template_path}.operators[{operator_id}]"
        definition = definitions.get(operator.get("definition_id"))
        if definition is None:
            problems.append(GraphProblem(f"{operator_path}.definition_id", "broken_reference", "operator definition does not resolve"))
            continue
        _require_count(operator.get("multiplicity"), template_environment, f"{operator_path}.multiplicity", problems)
        _validate_bindings(operator.get("bindings"), definition.get("parameters"), template_environment, f"{operator_path}.bindings", problems)
        for direction, declared in (("inputs", definition.get("input_ports")), ("outputs", definition.get("output_ports"))):
            actual = _binding_map(operator.get(direction))
            expected = set(declared) if isinstance(declared, list) else set()
            if set(actual) != expected:
                problems.append(GraphProblem(f"{operator_path}.{direction}", "invalid_port", "operator ports must match the definition"))
            for binding in actual.values():
                if binding.get("tensor_id") not in tensors:
                    problems.append(GraphProblem(f"{operator_path}.{direction}", "broken_reference", "operator tensor does not resolve"))
    _validate_ports_and_endpoints(
        template.get("tensors"), operators, "operator",
        input_tensor_ids, output_tensor_ids, template_path, problems,
    )


def graph_semantic_problems(record: Mapping[str, object]) -> list[GraphProblem]:
    """Validate closed graph relationships and expression evaluation scopes."""
    problems: list[GraphProblem] = []
    symbols = _mapping_list(record.get("shape_symbols"))
    try:
        globals_ = resolve_symbols(symbols)
    except ValueError as error:
        problems.append(GraphProblem("$.shape_symbols", "invalid_symbols", str(error)))
        globals_ = {}

    definitions = _ids(record.get("operator_definitions"), "definition_id", "$.operator_definitions", problems)
    component_templates = _ids(
        record.get("component_templates"),
        "template_id",
        "$.component_templates",
        problems,
    )
    templates = _ids(record.get("block_templates"), "template_id", "$.block_templates", problems)
    stages = _ids(record.get("stages"), "stage_id", "$.stages", problems)
    graph_tensors = _ids(record.get("graph_tensors"), "tensor_id", "$.graph_tensors", problems)
    graph_inputs = {value for value in record.get("graph_inputs", []) if isinstance(value, str)}
    graph_outputs = {value for value in record.get("graph_outputs", []) if isinstance(value, str)}
    for field, values in (("graph_inputs", graph_inputs), ("graph_outputs", graph_outputs)):
        for tensor_id in values:
            if tensor_id not in graph_tensors:
                problems.append(GraphProblem(f"$.{field}", "broken_reference", "graph tensor reference does not resolve"))
    _validate_axes(record.get("graph_tensors"), globals_, "$.graph_tensors", problems)

    for definition_id, definition in definitions.items():
        parameters = definition.get("parameters")
        if len(parameters) != len(set(parameters)) if isinstance(parameters, list) else True:
            problems.append(GraphProblem(f"$.operator_definitions[{definition_id}].parameters", "duplicate", "definition parameters must be unique"))
        for analysis_index, analysis in enumerate(_mapping_list(definition.get("analysis"))):
            _problem_value(
                problems,
                f"$.operator_definitions[{definition_id}].analysis[{analysis_index}].expression",
                lambda analysis=analysis, parameters=parameters: evaluate_expression(
                    analysis.get("expression"), {name: 1 for name in parameters if isinstance(name, str)}
                ),
            )

    for template_id, template in component_templates.items():
        _validate_atomic_template(
            template,
            f"$.component_templates[{template_id}]",
            definitions,
            problems,
        )

    for template_id, template in templates.items():
        template_path = f"$.block_templates[{template_id}]"
        parameters = template.get("parameters")
        if not isinstance(parameters, list) or len(parameters) != len(set(parameters)):
            problems.append(GraphProblem(f"{template_path}.parameters", "duplicate", "template parameters must be unique"))
        template_environment = {name: 1 for name in parameters if isinstance(name, str)}
        tensors = _ids(template.get("tensors"), "tensor_id", f"{template_path}.tensors", problems)
        operators = _ids(template.get("operators"), "operator_id", f"{template_path}.operators", problems)
        components = _ids(template.get("components"), "component_id", f"{template_path}.components", problems)
        if bool(operators) == bool(components):
            problems.append(
                GraphProblem(
                    template_path,
                    "invalid_composition",
                    "exactly one of operators or components must be non-empty",
                )
            )
        input_ports = _binding_map(template.get("input_ports"))
        output_ports = _binding_map(template.get("output_ports"))
        input_tensor_ids = {binding.get("tensor_id") for binding in input_ports.values() if isinstance(binding.get("tensor_id"), str)}
        output_tensor_ids = {binding.get("tensor_id") for binding in output_ports.values() if isinstance(binding.get("tensor_id"), str)}
        for port, binding in {**input_ports, **output_ports}.items():
            if binding.get("tensor_id") not in tensors:
                problems.append(GraphProblem(f"{template_path}.ports[{port}]", "broken_reference", "template port tensor does not resolve"))
        _validate_axes(template.get("tensors"), template_environment, f"{template_path}.tensors", problems)
        for operator_id, operator in operators.items():
            operator_path = f"{template_path}.operators[{operator_id}]"
            definition = definitions.get(operator.get("definition_id"))
            if definition is None:
                problems.append(GraphProblem(f"{operator_path}.definition_id", "broken_reference", "operator definition does not resolve"))
                continue
            _require_count(operator.get("multiplicity"), template_environment, f"{operator_path}.multiplicity", problems)
            _validate_bindings(operator.get("bindings"), definition.get("parameters"), template_environment, f"{operator_path}.bindings", problems)
            for direction, declared in (("inputs", definition.get("input_ports")), ("outputs", definition.get("output_ports"))):
                actual = _binding_map(operator.get(direction))
                expected = set(declared) if isinstance(declared, list) else set()
                if set(actual) != expected:
                    problems.append(GraphProblem(f"{operator_path}.{direction}", "invalid_port", "operator ports must match the definition"))
                for binding in actual.values():
                    if binding.get("tensor_id") not in tensors:
                        problems.append(GraphProblem(f"{operator_path}.{direction}", "broken_reference", "operator tensor does not resolve"))
        for component_id, component in components.items():
            component_path = f"{template_path}.components[{component_id}]"
            component_template = component_templates.get(component.get("template_id"))
            if component_template is None:
                problems.append(GraphProblem(f"{component_path}.template_id", "broken_reference", "component template does not resolve"))
                continue
            _validate_bindings(
                component.get("bindings"),
                component_template.get("parameters"),
                template_environment,
                f"{component_path}.bindings",
                problems,
            )
            binding_expressions = {
                binding["symbol"]: binding.get("expression")
                for binding in _mapping_list(component.get("bindings"))
                if isinstance(binding.get("symbol"), str)
            }
            component_tensors = {
                item["tensor_id"]: item
                for item in _mapping_list(component_template.get("tensors"))
                if isinstance(item.get("tensor_id"), str)
            }
            for direction, ports in (
                ("inputs", component_template.get("input_ports")),
                ("outputs", component_template.get("output_ports")),
            ):
                actual = _component_port_map(
                    component.get(direction),
                    f"{component_path}.{direction}",
                    problems,
                )
                expected = _binding_map(ports)
                if set(actual) != set(expected):
                    problems.append(GraphProblem(f"{component_path}.{direction}", "invalid_port", "component ports must match the template"))
                for port, binding in actual.items():
                    tensor_id = binding.get("tensor_id")
                    if tensor_id not in tensors:
                        problems.append(GraphProblem(f"{component_path}.{direction}", "broken_reference", "component tensor does not resolve"))
                        continue
                    component_port = expected.get(port)
                    if component_port is None:
                        continue
                    block_shape = _symbolic_shape(tensors[tensor_id])
                    component_shape = _symbolic_shape(
                        component_tensors.get(component_port.get("tensor_id")),
                        binding_expressions,
                    )
                    if block_shape is not None and component_shape is not None and block_shape != component_shape:
                        problems.append(GraphProblem(f"{component_path}.{direction}[{port}]", "boundary_mismatch", "component boundary tensor shapes must match"))
        node_kind = "component" if components else "operator"
        nodes = components if components else operators
        _validate_ports_and_endpoints(
            template.get("tensors"), nodes, node_kind,
            input_tensor_ids, output_tensor_ids, template_path, problems,
        )

    modules: dict[str, Mapping[str, object]] = {}
    repeat_carried_outputs: set[str] = set()
    for stage_id, stage in stages.items():
        stage_path = f"$.stages[{stage_id}]"
        _require_count(stage.get("repeat"), globals_, f"{stage_path}.repeat", problems)
        stage_modules = _ids(stage.get("modules"), "module_id", f"{stage_path}.modules", problems)
        for module_id, module in stage_modules.items():
            if module_id in modules:
                problems.append(GraphProblem(f"{stage_path}.modules[{module_id}].module_id", "duplicate", "module ID must be unique in graph scope"))
            modules[module_id] = module
            module_path = f"{stage_path}.modules[{module_id}]"
            template = templates.get(module.get("template_id"))
            if template is None:
                problems.append(GraphProblem(f"{module_path}.template_id", "broken_reference", "module template does not resolve"))
                continue
            module_repeat = _require_count(
                module.get("repeat"), globals_, f"{module_path}.repeat", problems
            )
            parameter_bindings = _validate_bindings(
                module.get("bindings"),
                template.get("parameters"),
                globals_,
                f"{module_path}.bindings",
                problems,
            )
            template_inputs = _binding_map(template.get("input_ports"))
            template_outputs = _binding_map(template.get("output_ports"))
            for direction, ports in (("inputs", template.get("input_ports")), ("outputs", template.get("output_ports"))):
                actual = _binding_map(module.get(direction))
                expected = set(_binding_map(ports))
                if set(actual) != expected:
                    problems.append(GraphProblem(f"{module_path}.{direction}", "invalid_port", "module ports must match the template"))
                for binding in actual.values():
                    if binding.get("tensor_id") not in graph_tensors:
                        problems.append(GraphProblem(f"{module_path}.{direction}", "broken_reference", "module tensor does not resolve"))
            module_inputs = _binding_map(module.get("inputs"))
            module_outputs = _binding_map(module.get("outputs"))
            repeat_carried = module.get("repeat_carried")
            if repeat_carried is not None:
                carry_path = f"{module_path}.repeat_carried"
                if not isinstance(repeat_carried, Mapping):
                    problems.append(GraphProblem(carry_path, "invalid_repeat_carry", "repeat carry must be an object or null"))
                else:
                    input_port = repeat_carried.get("input_port")
                    output_port = repeat_carried.get("output_port")
                    input_binding = module_inputs.get(input_port)
                    output_binding = module_outputs.get(output_port)
                    template_input_binding = template_inputs.get(input_port)
                    template_output_binding = template_outputs.get(output_port)
                    if (
                        input_binding is None
                        or output_binding is None
                        or template_input_binding is None
                        or template_output_binding is None
                    ):
                        problems.append(GraphProblem(carry_path, "invalid_repeat_carry", "repeat carry ports must resolve to module and template boundaries"))
                    elif module_repeat is not None:
                        if module_repeat <= 1:
                            problems.append(GraphProblem(carry_path, "invalid_repeat_carry", "repeat carry requires a module repeat greater than one"))
                        input_tensor_id = input_binding.get("tensor_id")
                        output_tensor_id = output_binding.get("tensor_id")
                        if input_tensor_id == output_tensor_id:
                            problems.append(GraphProblem(carry_path, "invalid_repeat_carry", "repeat carry input and output tensors must be distinct"))
                        if isinstance(output_tensor_id, str):
                            repeat_carried_outputs.add(output_tensor_id)
                        template_tensors = {
                            item["tensor_id"]: item
                            for item in _mapping_list(template.get("tensors"))
                            if isinstance(item.get("tensor_id"), str)
                        }
                        input_shapes = (
                            _concrete_shape(graph_tensors.get(input_tensor_id), globals_),
                            _concrete_shape(template_tensors.get(template_input_binding.get("tensor_id")), parameter_bindings),
                        )
                        output_shapes = (
                            _concrete_shape(graph_tensors.get(output_tensor_id), globals_),
                            _concrete_shape(template_tensors.get(template_output_binding.get("tensor_id")), parameter_bindings),
                        )
                        if None not in input_shapes + output_shapes and (
                            input_shapes[0] != input_shapes[1]
                            or output_shapes[0] != output_shapes[1]
                            or input_shapes[1] != output_shapes[1]
                        ):
                            problems.append(GraphProblem(carry_path, "invalid_repeat_carry", "repeat-carried hidden shapes must match"))
            for indexed_index, indexed in enumerate(_mapping_list(module.get("indexed_inputs"))):
                indexed_path = f"{module_path}.indexed_inputs[{indexed_index}]"
                port = indexed.get("port")
                tensor_id = indexed.get("tensor_id")
                if (
                    port not in module_inputs
                    or module_inputs[port].get("tensor_id") != tensor_id
                    or tensor_id not in graph_tensors
                ):
                    problems.append(GraphProblem(indexed_path, "broken_reference", "indexed input does not resolve"))
                    continue
                template_binding = template_inputs.get(port)
                template_tensors = {
                    item["tensor_id"]: item
                    for item in _mapping_list(template.get("tensors"))
                    if isinstance(item.get("tensor_id"), str)
                }
                _validate_indexed_boundary(
                    indexed,
                    graph_tensors.get(tensor_id),
                    template_tensors.get(template_binding.get("tensor_id")) if template_binding else None,
                    globals_,
                    parameter_bindings,
                    module_repeat,
                    indexed_path,
                    "invalid_indexed_input",
                    problems,
                )
            seen_collected_ports: set[str] = set()
            for collected_index, collected in enumerate(_mapping_list(module.get("collected_outputs"))):
                collected_path = f"{module_path}.collected_outputs[{collected_index}]"
                port = collected.get("port")
                tensor_id = collected.get("tensor_id")
                if port in seen_collected_ports:
                    problems.append(GraphProblem(collected_path, "duplicate", "collected output port must be unique"))
                elif isinstance(port, str):
                    seen_collected_ports.add(port)
                if (
                    port not in module_outputs
                    or module_outputs[port].get("tensor_id") != tensor_id
                    or tensor_id not in graph_tensors
                ):
                    problems.append(GraphProblem(collected_path, "broken_reference", "collected output does not resolve"))
                    continue
                template_binding = template_outputs.get(port)
                template_tensors = {
                    item["tensor_id"]: item
                    for item in _mapping_list(template.get("tensors"))
                    if isinstance(item.get("tensor_id"), str)
                }
                _validate_indexed_boundary(
                    collected,
                    graph_tensors.get(tensor_id),
                    template_tensors.get(template_binding.get("tensor_id")) if template_binding else None,
                    globals_,
                    parameter_bindings,
                    module_repeat,
                    collected_path,
                    "invalid_collection",
                    problems,
                )

    loop_endpoints: dict[str, dict[str, object]] = {}
    loop_inputs = set(graph_inputs)
    loop_outputs = set(graph_outputs)
    for stage_id, stage in stages.items():
        loop = stage.get("loop_carried")
        if loop is None:
            continue
        if not isinstance(loop, Mapping):
            problems.append(GraphProblem(f"$.stages[{stage_id}].loop_carried", "invalid_loop", "loop_carried must be null or an object"))
            continue
        for field in ("initial_tensor_id", "iteration_input_tensor_id", "iteration_output_tensor_id", "final_tensor_id"):
            if loop.get(field) not in graph_tensors:
                problems.append(GraphProblem(f"$.stages[{stage_id}].loop_carried.{field}", "broken_reference", "loop tensor does not resolve"))
        loop_id = loop.get("loop_id")
        if not isinstance(loop_id, str) or not loop_id:
            problems.append(GraphProblem(f"$.stages[{stage_id}].loop_carried.loop_id", "invalid_loop", "loop ID must be non-empty"))
            continue
        initial = loop.get("initial_tensor_id")
        iteration_input = loop.get("iteration_input_tensor_id")
        iteration_output = loop.get("iteration_output_tensor_id")
        final = loop.get("final_tensor_id")
        if all(isinstance(value, str) and value in graph_tensors for value in (initial, iteration_input, iteration_output, final)):
            if len({initial, iteration_input, iteration_output, final}) != 4:
                problems.append(GraphProblem(f"$.stages[{stage_id}].loop_carried", "invalid_loop", "loop tensors must be distinct"))
            loop_endpoints.setdefault(initial, {"consumers": set()})["consumers"].add((loop_id, "initial"))
            loop_endpoints.setdefault(iteration_input, {})["producer"] = (loop_id, "iteration_input")
            loop_endpoints.setdefault(iteration_output, {"consumers": set()})["consumers"].add((loop_id, "iteration_output"))
            loop_endpoints[iteration_output]["optional_consumer"] = True
            loop_endpoints.setdefault(final, {})["producer"] = (loop_id, "final")
            loop_inputs.add(iteration_input)
            loop_outputs.add(iteration_output)
    _validate_ports_and_endpoints(
        record.get("graph_tensors"), modules, "module", loop_inputs,
        loop_outputs | repeat_carried_outputs,
        "$", problems, loop_endpoints,
    )
    return problems


def _concrete_tensors(tensors: object, environment: Mapping[str, Number]) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for tensor in _mapping_list(tensors):
        copied = dict(tensor)
        copied["shape"] = [int(evaluate_expression(axis.get("expression"), environment)) for axis in _mapping_list(tensor.get("axes"))]
        result.append(copied)
    return result


def _materialize_atomic_template(
    template: Mapping[str, object],
    environment: Mapping[str, Number],
    effective_repeat: int,
    key_prefix: str,
    definitions: Mapping[str, Mapping[str, object]],
    operators_by_id: dict[str, dict[str, object]],
) -> dict[str, object]:
    template_copy = dict(template)
    template_copy["tensors"] = _concrete_tensors(template.get("tensors"), environment)
    materialized_operators: list[dict[str, object]] = []
    for operator in _mapping_list(template.get("operators")):
        operator_copy = dict(operator)
        definition = definitions[operator["definition_id"]]
        definition_bindings = _evaluate_bindings(
            operator.get("bindings"), definition.get("parameters"), environment
        )
        operator_copy["bindings"] = definition_bindings
        operator_copy["multiplicity"] = int(
            evaluate_expression(operator.get("multiplicity"), environment)
        )
        analysis = []
        analysis_by_metric: dict[str, object] = {}
        for metric in _mapping_list(definition.get("analysis")):
            item = dict(metric)
            item["value"] = evaluate_expression(
                metric.get("expression"), definition_bindings
            )
            analysis.append(item)
            analysis_by_metric[item["metric"]] = item["value"]
        operator_copy["analysis"] = analysis
        operator_copy["analysis_by_metric"] = analysis_by_metric
        operator_copy["effective_repeat"] = (
            effective_repeat * operator_copy["multiplicity"]
        )
        materialized_operators.append(operator_copy)
        operators_by_id[f"{key_prefix}/{operator['operator_id']}"] = operator_copy
    template_copy["operators"] = materialized_operators
    return template_copy


def materialize_model_graph(
    record: Mapping[str, object], overrides: Mapping[str, Number] | None = None
) -> dict[str, object]:
    """Fold a valid model graph into one concrete representative per module."""
    problems = graph_semantic_problems(record)
    if problems:
        first = problems[0]
        raise ValueError(f"{first.path}: {first.message}")
    globals_ = resolve_symbols(_mapping_list(record.get("shape_symbols")), overrides)
    graph_tensors = _concrete_tensors(record.get("graph_tensors"), globals_)
    graph_shapes = {tensor["tensor_id"]: tensor["shape"] for tensor in graph_tensors}
    graph_tensors_by_id = {tensor["tensor_id"]: tensor for tensor in graph_tensors}
    templates = {item["template_id"]: item for item in _mapping_list(record.get("block_templates"))}
    component_templates = {
        item["template_id"]: item
        for item in _mapping_list(record.get("component_templates"))
    }
    definitions = {item["definition_id"]: item for item in _mapping_list(record.get("operator_definitions"))}
    named_repeats: dict[str, Number] = {}
    operators_by_id: dict[str, dict[str, object]] = {}
    stages: list[dict[str, object]] = []
    for stage in _mapping_list(record.get("stages")):
        stage_copy = dict(stage)
        stage_repeat = int(evaluate_expression(stage.get("repeat"), globals_))
        stage_copy["stage_repeat"] = stage_repeat
        materialized_modules: list[dict[str, object]] = []
        for module in _mapping_list(stage.get("modules")):
            module_copy = dict(module)
            template = templates[module["template_id"]]
            parameter_bindings = _evaluate_bindings(module.get("bindings"), template.get("parameters"), globals_)
            module_repeat = int(evaluate_expression(module.get("repeat"), globals_))
            effective_repeat = stage_repeat * module_repeat
            module_copy.update({"bindings": parameter_bindings, "module_repeat": module_repeat, "effective_repeat": effective_repeat})
            module_copy["inputs"] = _materialized_ports(module.get("inputs"), graph_shapes)
            module_copy["outputs"] = _materialized_ports(module.get("outputs"), graph_shapes)
            module_copy["indexed_inputs"] = _materialized_indexed_boundaries(
                module.get("indexed_inputs"), graph_tensors_by_id
            )
            module_copy["collected_outputs"] = _materialized_indexed_boundaries(
                module.get("collected_outputs"), graph_tensors_by_id
            )
            module_copy["repeat_carried"] = _materialized_repeat_carry(
                module.get("repeat_carried"), module, graph_shapes
            )
            named_repeats[module["module_id"]] = effective_repeat
            template_copy = dict(template)
            template_copy["tensors"] = _concrete_tensors(template.get("tensors"), parameter_bindings)
            key_prefix = f"{stage['stage_id']}/{module['module_id']}"
            if _mapping_list(template.get("operators")):
                template_copy = _materialize_atomic_template(
                    template,
                    parameter_bindings,
                    effective_repeat,
                    key_prefix,
                    definitions,
                    operators_by_id,
                )
            else:
                block_shapes = {
                    tensor["tensor_id"]: tensor["shape"]
                    for tensor in template_copy["tensors"]
                }
                materialized_components: list[dict[str, object]] = []
                for component in _mapping_list(template.get("components")):
                    component_copy = dict(component)
                    component_template = component_templates[component["template_id"]]
                    component_bindings = _evaluate_bindings(
                        component.get("bindings"),
                        component_template.get("parameters"),
                        parameter_bindings,
                    )
                    component_copy["bindings"] = component_bindings
                    component_copy["inputs"] = _materialized_ports(
                        component.get("inputs"), block_shapes
                    )
                    component_copy["outputs"] = _materialized_ports(
                        component.get("outputs"), block_shapes
                    )
                    component_copy["template"] = _materialize_atomic_template(
                        component_template,
                        component_bindings,
                        effective_repeat,
                        f"{key_prefix}/{component['component_id']}",
                        definitions,
                        operators_by_id,
                    )
                    materialized_components.append(component_copy)
                template_copy["components"] = materialized_components
            module_copy["template"] = template_copy
            materialized_modules.append(module_copy)
        stage_copy["modules"] = materialized_modules
        stages.append(stage_copy)
    tensors_by_id = {tensor["tensor_id"]: tensor for tensor in graph_tensors}
    result = dict(record)
    result.update({
        "bindings": globals_,
        "graph_tensors": graph_tensors,
        "graph_inputs": [tensors_by_id[tensor_id] for tensor_id in record.get("graph_inputs", [])],
        "graph_outputs": [tensors_by_id[tensor_id] for tensor_id in record.get("graph_outputs", [])],
        "stages": stages,
        "named_repeats": named_repeats,
        "operators_by_id": operators_by_id,
    })
    return result


def _evaluate_bindings(bindings: object, expected: object, environment: Mapping[str, Number]) -> dict[str, Number]:
    actual = {item["symbol"]: item for item in _mapping_list(bindings)}
    return {
        symbol: evaluate_expression(actual[symbol].get("expression"), environment)
        for symbol in expected if isinstance(expected, list)
    }


def _materialized_ports(bindings: object, shapes: Mapping[str, object]) -> list[dict[str, object]]:
    result = []
    for binding in _mapping_list(bindings):
        item = dict(binding)
        item["shape"] = shapes[binding["tensor_id"]]
        result.append(item)
    return result


def _materialized_indexed_boundaries(
    annotations: object, tensors: Mapping[str, Mapping[str, object]]
) -> list[dict[str, object]]:
    result: list[dict[str, object]] = []
    for annotation in _mapping_list(annotations):
        item = dict(annotation)
        tensor = tensors[annotation["tensor_id"]]
        shape = tensor["shape"]
        axes = [axis["axis"] for axis in _mapping_list(tensor.get("axes"))]
        axis_index = axes.index(annotation["axis"])
        item["shape"] = shape
        item["element_shape"] = shape[:axis_index] + shape[axis_index + 1 :]
        result.append(item)
    return result


def _materialized_repeat_carry(
    repeat_carried: object,
    module: Mapping[str, object],
    shapes: Mapping[str, object],
) -> dict[str, object] | None:
    if not isinstance(repeat_carried, Mapping):
        return None
    item = dict(repeat_carried)
    inputs = _binding_map(module.get("inputs"))
    outputs = _binding_map(module.get("outputs"))
    input_tensor_id = inputs[repeat_carried["input_port"]]["tensor_id"]
    output_tensor_id = outputs[repeat_carried["output_port"]]["tensor_id"]
    item.update({
        "input_tensor_id": input_tensor_id,
        "output_tensor_id": output_tensor_id,
        "input_shape": shapes[input_tensor_id],
        "output_shape": shapes[output_tensor_id],
    })
    return item
