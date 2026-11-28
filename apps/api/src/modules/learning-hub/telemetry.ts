/** Progress is telemetry, never a second transport for model output or tool arguments. */
export function safeLearningProgress(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(({ usage, ...step }) => {
    // Existing records may contain full provider responses in usage metadata.
    const { id, label, status, detail, updatedAt } = step;
    return {
      id,
      label,
      status,
      ...(detail ? { detail } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(usage && typeof usage === 'object' ? { usage: safeLearningUsage(usage) } : {}),
    };
  });
}
export function safeLearningUsage(value: Record<string, unknown>) {
  const { provider, model, inputTokens, outputTokens } = value;
  return { provider, model, inputTokens, outputTokens };
}
export function safeLearningEvent(value: unknown) {
  if (value && typeof value === 'object' && 'type' in value && value.type === 'usage') {
    const payload = value as Record<string, unknown>;
    return { type: 'usage', stage: payload.stage, ...safeLearningUsage(payload) };
  }
  return value;
}
