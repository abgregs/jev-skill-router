export { route } from './route.js'
export { applyPolicy } from './policy.js'
export { createMockJudge } from './mockJudge.js'
export { createRecordedJudge, runFromEvalRecording } from './recordedJudge.js'
export type { RecordedRun } from './recordedJudge.js'
export type { JevJudge, JudgeRequest, JudgeResult } from './judge.js'
export type { MockJudgeConfig } from './mockJudge.js'

// The REAL judge (createJevJudge) is intentionally NOT re-exported here. Import it
// directly from './jevJudge.js' when you want it. Barrel re-export would pull
// '@typesafe-ai/sdk' into every consumer's import graph; keeping it a direct, lazy
// import means the mock pipeline (bench, inspect, demo-without-key) runs zero-install.
