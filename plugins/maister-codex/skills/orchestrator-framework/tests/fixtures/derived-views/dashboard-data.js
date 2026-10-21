window.MAISTER_DATA = {
  generated: "2026-10-20T12:00:00Z",
  task: {
    title: "Derived view fixture",
    status: "in_progress"
  },
  phases: [
    {
      id: "phase-1",
      name: "Analysis",
      status: "completed",
      summary_keys: ["analysis"],
      decisions: [
        {decision: "Keep canonical state authoritative.", rationale: "Derived views only report drift."},
        "Preserve decision order."
      ],
      risks: ["Stale projections can mislead operators."],
      artifacts: []
    },
    {
      id: "phase-2",
      name: "Optional work",
      status: "skipped",
      decisions: [],
      risks: [],
      artifacts: []
    },
    {
      id: "phase-3",
      name: "Blocked work",
      status: "blocked",
      summary_keys: ["planning"],
      decisions: ["Validate registry namespaces separately."],
      risks: [],
      artifacts: []
    }
  ]
};
