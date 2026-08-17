export function isHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function citationError(input: {
  dataGap: boolean;
  value: number | null | undefined;
  assessorLevel: number | null | undefined;
  sourceName: string | null | undefined;
  sourceUrl: string | null | undefined;
}): string | null {
  if (input.dataGap) return null;
  const needsCite =
    (input.value !== null && input.value !== undefined && !Number.isNaN(input.value)) ||
    (input.assessorLevel !== null && input.assessorLevel !== undefined);
  if (!needsCite) return null;
  if (!input.sourceName?.trim()) {
    return "A verified source name is required before a value or assessor level can enter the evidence base.";
  }
  if (!isHttpUrl(input.sourceUrl)) {
    return "A public http(s) source URL is required so the figure can be checked.";
  }
  return null;
}

export function nextProvenance(input: {
  dataGap: boolean;
  assessorLevel: number | null | undefined;
  value: number | null | undefined;
  current: string | null;
}): "assessor" | "manual" | "named-gap" | string | null {
  if (input.dataGap) return input.current ?? "named-gap";
  if (input.assessorLevel !== null && input.assessorLevel !== undefined) return "assessor";
  if (input.value !== null && input.value !== undefined) {
    if (input.current === "machine-imported" || input.current === "proxy" || input.current === "machine-researched") return input.current;
    return "manual";
  }
  return input.current;
}
