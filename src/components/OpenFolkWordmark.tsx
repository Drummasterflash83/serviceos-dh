import * as React from "react";

/** Approved invoice/homepage identity. Do not create per-module logo variants. */
export function OpenFolkWordmark({
  onDark = false,
  size = 28,
}: {
  onDark?: boolean;
  size?: number | "inherit";
}) {
  return (
    <span
      aria-label="OpenFolk"
      style={{
        fontFamily: "Helvetica, Arial, sans-serif",
        fontWeight: 700,
        fontSize: size,
        letterSpacing: "-0.035em",
        whiteSpace: "nowrap",
        display: "inline-block",
      }}
    >
      <span style={{ color: onDark ? "#fff" : "#203F70" }}>open</span>
      <span style={{ color: "#CC8625" }}>folk</span>
    </span>
  );
}
