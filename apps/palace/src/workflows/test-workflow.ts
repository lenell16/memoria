export async function testWorkflow(topic = "workflow-tester") {
  "use workflow";

  const startedAt = await recordStart();
  const normalizedTopic = await normalizeTopic(topic);
  const summary = await buildSummary(topic, normalizedTopic, startedAt);

  return {
    topic: normalizedTopic,
    startedAt,
    summary,
  };
}

async function recordStart() {
  "use step";

  return new Date().toISOString();
}

async function normalizeTopic(topic: string) {
  "use step";

  return topic.trim().toLowerCase().replace(/\s+/g, "-");
}

async function buildSummary(topic: string, normalizedTopic: string, startedAt: string) {
  "use step";

  return `Test workflow started for "${topic}" (${normalizedTopic}) at ${startedAt}.`;
}
