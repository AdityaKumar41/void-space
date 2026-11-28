import { createAgent, createNetwork, openai } from '@inngest/agent-kit';
/** Deterministic routing bounds the network; specialists retain the existing validated provider adapter. */
export async function runLearningNetwork(stages: {
  sources: () => Promise<void>;
  coordinator: () => Promise<void>;
  actions: () => string[];
  act: (action: string) => Promise<void>;
  review: () => Promise<void>;
}) {
  const specialist = (name: string, run: () => Promise<void>) =>
    createAgent({
      name,
      system:
        'Use only the supplied, permission-checked learning tools. Produce private reviewable drafts.',
      lifecycle: {
        onStart: async ({ prompt, history }) => {
          // Calls use our provider abstraction, retaining its free-model policy, validation and fallback.
          await run();
          return { prompt, history: history ?? [], stop: true };
        },
      },
    });
  const source = specialist('Source specialist', stages.sources);
  const coordinator = specialist('Learning coordinator', stages.coordinator);
  const reviewer = specialist('Draft reviewer', stages.review);
  const toolNames = [
    'respond',
    'create_lesson',
    'revise_lesson',
    'find_lessons',
    'find_models',
    'label_model',
    'generate_image',
  ];
  const tools = toolNames.map((action) =>
    specialist(`Learning tool: ${action}`, () => stages.act(action)),
  );
  let phase = 0;
  let actionIndex = 0;
  // AgentKit requires a model descriptor even when lifecycle hooks delegate all inference.
  // No request is sent through this descriptor: each specialist uses generateText instead.
  const network = createNetwork({
    defaultModel: openai({ model: 'void-space-provider-adapter' }),
    name: 'Void Space private learning',
    agents: [source, coordinator, ...tools, reviewer],
    maxIter: 6,
    router: () => {
      if (phase === 0) {
        phase++;
        return source;
      }
      if (phase === 1) {
        phase++;
        return coordinator;
      }
      const actions = stages.actions();
      if (actions.length > 2) throw new Error('Learning run exceeds its action budget.');
      if (actionIndex < actions.length) {
        const action = actions[actionIndex++]!;
        const agent = tools[toolNames.indexOf(action)];
        if (!agent) throw new Error('Unsupported learning tool');
        return agent;
      }
      if (phase === 2) {
        phase++;
        return reviewer;
      }
      return undefined;
    },
  });
  await network.run('Complete this private learning request using the selected material.');
}
export type Checkpoint = <T>(id: string, run: () => Promise<T>) => Promise<T>;
