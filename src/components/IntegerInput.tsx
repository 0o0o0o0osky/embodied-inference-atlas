import { useEffect, useState, type InputHTMLAttributes } from "react";

type IntegerInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "min" | "max"> & {
  value: number;
  min: number;
  max?: number | undefined;
  onValueChange: (value: number) => void;
};

/** Keep editing text separate from the last valid shape used by the model. */
export function IntegerInput({ value, min, max, onValueChange, ...props }: IntegerInputProps) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <input {...props} type="number" inputMode="numeric" step={1} min={min} max={max}
    value={draft}
    onChange={(event) => {
      const text = event.target.value;
      setDraft(text);
      const next = Number(text);
      if (text.trim() !== "" && Number.isSafeInteger(next) && next >= min && (max === undefined || next <= max)) {
        onValueChange(next);
      }
    }}
    onBlur={(event) => {
      setDraft(String(value));
      props.onBlur?.(event);
    }}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
      props.onKeyDown?.(event);
    }}
  />;
}
