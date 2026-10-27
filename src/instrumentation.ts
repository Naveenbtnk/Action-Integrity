export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { registerTelemetry } = await import('@/lib/observability/tracing');
  await registerTelemetry();
}
