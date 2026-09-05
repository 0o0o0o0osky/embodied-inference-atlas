import { OperatorDrawer, type OperatorDrawerProps } from "./OperatorDrawer";

export function OperatorInspector(props: OperatorDrawerProps) {
  return <OperatorDrawer key={props.resetKey} {...props} />;
}
