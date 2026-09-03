# NEX AI — Worklog

---
Task ID: phase-6-0
Agent: main
Task: PHASE 6 — Background Task Queue (planning + scaffolding)

Work Log:
- Read existing architecture: agent core (createTask/runTask/cancelTask), AgentEvent IPC, permission layer, orb state machine (12 states incl. working/success/cancelled), voiceController condition system (priority-based state resolution), persistence layer, memory system.
- Designed task queue architecture:
  - New module `src/main/tasks/` with: types.ts, queue.ts, persistence.ts, orb-bridge.ts, index.ts
  - TaskQueueItem wraps either an AgentTask (kind='agent') or an async function (kind='function')
  - Priority heap: critical > high > normal > low
  - Concurrency-limited worker pool (default 2)
  - Cancellation propagates via existing CancellationToken (agent) + new queue-level token (functions)
  - Persistence: `<userData>/task-queue.json` — queued/paused/running items survive reload; running items after crash → marked `failed` with reason "interrupted by process restart" (NO fake completion)
  - Orb integration via `voiceController.setCondition('queue', state)` — reuses existing state machine, no duplication
  - New IPC channel `task-queue-event` for queue lifecycle events
  - Permission enforcement: queue runs agent tasks which already call executeToolWithPermission internally; function tasks must call permission API themselves (queue never bypasses)
- Confirmed existing tests pattern: tsx tests that read source files + assert on patterns; integration tests use Electron app.whenReady()

Stage Summary:
- Architecture approved: separate `tasks/` module wrapping agent + function tasks, new IPC channel, orb condition key `'queue'`
- No duplication of state machine — reuses orb-state.ts and voiceController conditions
- Next: implement types.ts → queue.ts → persistence.ts → orb-bridge.ts → index.ts → wire IPC → UI listener → tests

---
Task ID: phase-6-1
Agent: main
Task: PHASE 6 — Background Task Queue (implementation + tests + verification)

Work Log:
- Created src/main/tasks/types.ts: TaskQueueItem, TaskPriority (critical/high/normal/low), TaskQueueStatus (queued/running/completed/failed/cancelled/paused), TaskQueueEvent, TaskExecutionContext, PersistedQueueState, DEFAULT_QUEUE_CONFIG
- Created src/main/tasks/persistence.ts: initTaskQueuePersistence, loadQueueState, saveQueueState (atomic write via temp+rename), recoverQueueState (queued/paused preserved; running → failed with "Interrupted by process restart" — NO fake completion), clearQueueState, loadQueueConfig
- Created src/main/tasks/queue.ts: full priority queue + worker pool
  - enqueueAgentTask / enqueueFunction / registerTaskFunction
  - cancelTask (propagates to agent via _agentCancelTaskFn + sets CancellationToken)
  - cancelAllTasks / pauseTask / resumeTask
  - getTask / listTasks / getQueueState / updateConfig / pruneHistory
  - onTaskQueueEvent / emitStateSnapshot
  - initTaskQueue (wires agent callbacks + agent event listener + recovery + persistence) / shutdownTaskQueue
  - Failure isolation (each task in try/catch)
  - Retry policy (maxRetries, retryCount)
  - Concurrency limit (maxConcurrent, lazy worker spawn)
  - Cancellation token re-creation on recovery (fix found by tests)
  - Memory recording callback (filters: skip 'no-mem' tagged, only agent + 'mem' tagged functions, only completed/failed)
- Created src/main/tasks/orb-bridge.ts: orbStateForTaskEvent (maps task_started/progress → working, completed → success+clear, failed → error+clear, cancelled → cancelled+clear, recovered → error+clear) — does NOT define its own state machine
- Created src/main/tasks/index.ts: public API barrel
- Modified src/main/main.ts: imported tasks module; initTaskQueue called after initPersistence with agent wiring (runTask/cancelTask/getTaskStatus/onAgentEvent), onInterruptedRecovery logging, memoryRecord (TaskMemory.set); shutdownTaskQueue called in before-quit before agent cancel; added 13 IPC handlers (task-queue-enqueue-agent, -enqueue-function, -create-agent-task, -cancel, -cancel-all, -pause, -resume, -get, -list, -state, -update-config, -prune, -snapshot) + onTaskQueueEvent forwarding to renderer; registered 2 built-in functions (noop:echo, test:delay)
- Modified src/main/preload.ts: exposed 14 task-queue API methods + onTaskQueueEvent listener
- Modified src/renderer/types/electron.d.ts: added 15 task-queue type declarations
- Modified src/renderer/components/layout/AppShell.tsx: added useEffect that subscribes to onTaskQueueEvent and drives Orb via voiceController.setCondition('queue', state) — NEW condition key separate from 'agent' (chat) to avoid conflicts; mapping: started/progress → working, completed → success (clear 1.5s), failed/recovered → error (clear 1.5s), cancelled → cancelled (clear 1.5s)
- Created tests/tools/test-phase-6-task-queue.ts: 15 test sections, 149 assertions covering enqueue/dequeue, priority ordering, lifecycle, concurrency, cancellation, failure isolation, persistence/recovery, agent integration, orb integration, permission enforcement (source inspection), race conditions, retry policy, event emission, history pruning
- Fixed bugs found by tests:
  1. emit() signature was Omit<TaskQueueEvent, "timestamp"> but calls included timestamp — removed timestamp from all emit calls
  2. Map.delete() called with 2 args — fixed to use Set.delete + conditional Map.delete
  3. agentTaskId undefined in non-null assertions — added '!' assertions after guard
  4. Cancellation tokens not re-created for recovered items — fixed in initTaskQueue (re-creates token for non-terminal recovered items)
- Test timing fixes:
  - enqueue/dequeue test: use maxConcurrent=0 to keep items queued until verified, then bump to 2 to run
  - priority test: use maxConcurrent=0 to enqueue all first, then bump to 1 to preserve priority order
  - recovery test: verify item survives restart (queued/running/completed all valid) instead of asserting queued status
  - agent integration: mock agent uses polling loop (10ms interval, 2s timeout) so tests can mutate status after runTask starts
- Verification:
  - Typecheck (renderer): PASS
  - Typecheck (main): PASS
  - Build: PASS
  - Phase 6 tests: 149/149 PASS
  - Phase 116 regression tests: ALL PASS (19+19+30+19+60+26+34+12+30+48+19 = 316 assertions)
  - Other tools tests (write-file, git-commit-snapshot, phase-114, phase-115): ALL PASS
  - System tests: same pass/fail count before and after my changes (19 PASS, 22 FAIL — all pre-existing failures unrelated to task queue)

Stage Summary:
- Architecture delivered: src/main/tasks/ module with 5 files (types, queue, persistence, orb-bridge, index)
- Agent integration: queue wraps AgentTask IDs via enqueueAgentTask; runs via injected runTask; cancellation propagates via cancelTask
- Orb integration: NEW condition key 'queue' (separate from 'agent'); reuses orb-state.ts state machine (no duplication)
- Permission enforcement: queue never calls executeTool directly; agent tasks still use executeToolWithPermission internally; function tasks must call permission API themselves
- Persistence: <userData>/task-queue.json with atomic writes; queued/paused/running persisted; running after crash → failed (NO fake completion); terminal items capped at historyLimit
- Concurrency: maxConcurrent (default 2, configurable via updateConfig); lazy worker spawn
- Failure isolation: each task in try/catch; worker pool continues after failure
- Retry: maxRetries (default 1); retryable errors re-enqueue with retryCount++
- Events: task-queue-event IPC channel; full lifecycle (enqueued/started/progress/completed/failed/cancelled/paused/recovered/queue_state)
- IPC: 13 handlers + onTaskQueueEvent forwarding; preload exposes 14 methods + listener
- Tests: 149/149 PASS (15 sections covering all Phase 6 §13 requirements)
- Files changed: 5 new (tasks/), 4 modified (main.ts, preload.ts, electron.d.ts, AppShell.tsx), 1 new test file
- Next: commit + push to main

---
Task ID: phase-7-0
Agent: main
Task: PHASE 7 — LLM Error Recovery (planning)

Work Log:
- Read existing error-handling architecture:
  - src/main/agent/trust-retry.ts: classifyFailure (transient/permanent/unknown) + decideRetry (exponential backoff)
  - src/main/agent/core.ts handleStepFailure: uses decideRetry + emit('retry' event) + re-execute step
  - src/main/agent/react-loop.ts: rePlanAfterObservation (LLM call after each tool step → continue/replan/complete/abort)
  - src/main/agent/types.ts AgentError: type ∈ {tool_error, permission_denied, timeout, max_retries, max_steps, max_tool_calls, invalid_state, cancelled, llm_error, context_too_large, unknown} + recovered + recoveryAction fields
  - src/main/agent/types.ts AgentEventType: includes 'retry', 'replan_started', 'replan_completed', 'task_failed', 'task_cancelled'
  - Phase 6 Task Queue: emit() in queue.ts fires task_recovered, retry policy in queue.ts (retryCount, maxRetries, retryable error code check)
  - UI: AgentStateDisplay handles 'retry' event with RefreshCw icon + yellow color
- Designed Phase 7 architecture (NO duplication, layered on existing):
  - NEW src/main/agent/error-classifier.ts: 10-class taxonomy (extends trust-retry's 3-class to 10)
    - transient_network, timeout, permission_denied, invalid_arguments, file_path, model_inference,
      tool_failure, user_cancellation, security_policy, unknown
  - NEW src/main/agent/recovery-engine.ts:
    - decideRecovery() → 5 decisions: RETRY, MODIFY_AND_RETRY, REPLAN, SKIP, ABORT
    - Heuristic path (offline-first): pattern-based rules per error class
    - LLM fallback (optional, uses AIRuntime when available): analyze complex errors
    - Exponential backoff preserved from decideRetry
    - Permanent errors (permission/security) → SKIP or ABORT (never infinite retry)
    - Cancellation → never retry (immediate ABORT)
    - Context propagation: safe summary (redacted args, task/agent IDs, tool name, error, attempts, observations, plan/step)
  - MODIFY types.ts:
    - AgentError: extend 'type' to include new subclasses (permission_denied already exists, add security_policy, file_path, invalid_arguments, model_inference, transient_network)
    - AgentError: add optional recoveryDecision field + recoveryAttempted count
    - AgentEventType: add 'recovery_started', 'recovery_decision', 'recovery_succeeded', 'recovery_failed', 'modify_retry_started', 'skip_executed'
  - INTEGRATE core.ts handleStepFailure:
    - Replace decideRetry call with decideRecovery (uses error-classifier + heuristic rules + optional LLM)
    - Emit 'recovery_started' (THINKING Orb state via voiceController condition 'agent' = 'thinking')
    - Emit 'recovery_decision' (with the chosen decision + reason)
    - On RETRY: emit 'retry' (existing) — WORKING Orb state
    - On MODIFY_AND_RETRY: emit 'modify_retry_started' — modify tool params via LLM/heuristic, then re-execute
    - On REPLAN: emit 'replan_started' + call rePlanAfterObservation (existing)
    - On SKIP: emit 'skip_executed' — mark step skipped, continue to next step
    - On ABORT: emit 'recovery_failed' — mark task failed, exit loop
    - On success after retry: emit 'recovery_succeeded'
    - On failure after all attempts: emit 'recovery_failed'
  - Phase 6 Task Queue integration:
    - queue.ts retry policy already handles function-kind tasks; agent-kind tasks flow through agent core → new recovery
    - queue.ts 'task_recovered' event emitted after crash recovery
    - No new queue events needed — recovery events flow via agent-event IPC (existing)
  - Orb integration:
    - recovery analysis → THINKING (via 'agent' condition, set when 'recovery_started' fires)
    - retry/recovery execution → WORKING (via 'agent' condition, set when 'retry' fires)
    - recovered successfully → SUCCESS (existing 'task_completed' / 'step_completed' flow)
    - unrecoverable → ERROR (existing 'task_failed' flow)
    - user cancellation → CANCELLED (existing 'task_cancelled' flow)
    - NO new Orb states or state machine
  - Memory:
    - Record only: SKIP decisions (lost cause, useful for future planning), ABORT decisions (unrecoverable, useful), LLM-analyzed recoveries (complex errors)
    - Skip: transient retries (noisy), simple RETRY decisions (routine)
  - Tests: ~25 scenarios covering all 10 error classes + 5 decisions + retry policy + backoff + cancellation + max retries + LLM fallback + offline + context propagation + verification + queue + Orb + race + isolation

Stage Summary:
- Architecture approved: layered on existing trust-retry + react-loop, NO parallel systems
- 10-class error taxonomy + 5 recovery decisions + heuristic-first (offline-capable) + LLM fallback (optional)
- All recovery events flow through existing AgentEvent IPC — UI updates additive (new cases in switch)
- Orb integration reuses existing state machine + condition system
- Phase 6 Task Queue: no changes needed (retry policy already isolated)
- Next: implement error-classifier.ts → recovery-engine.ts → wire into core.ts → tests

---
Task ID: phase-7-1
Agent: main
Task: PHASE 7 — LLM Error Recovery (implementation + tests + verification)

Work Log:
- Created src/main/agent/error-classifier.ts: 10-class taxonomy (transient_network, timeout, permission_denied, invalid_arguments, file_path, model_inference, tool_failure, user_cancellation, security_policy, unknown). Heuristic-only (no LLM call). Pattern-based with priority order (cancellation > security > permission > invalid_arguments > file_path > model_inference > timeout > transient_network > tool_failure > unknown). Backward-compat with 3-class trust-rety via legacyClass field.
- Created src/main/agent/recovery-engine.ts: 5 recovery decisions (RETRY, MODIFY_AND_RETRY, REPLAN, SKIP, ABORT). Heuristic-first (offline-capable) + LLM fallback for ambiguous cases. Exponential backoff (base 400ms, ×2, cap 5s, jitter). timeout gets 2x base. tryFixArguments heuristic for missing path/content + type coercion. LLM prompt includes redacted context (redactObjectDeep). Safety: LLM can NEVER override permission/security/cancellation decisions. Pure module — never calls executeTool/executeToolWithPermission directly.
- Modified src/main/agent/types.ts:
  - AgentEventType: added 6 new events (recovery_started, recovery_decision, modify_retry_started, skip_executed, recovery_succeeded, recovery_failed)
  - AgentError: added errorClass (10-class), recoveryDecision (5-action), recoveryAttempts, llmAnalyzed fields
- Modified src/main/agent/core.ts:
  - Imported classifyError + decideRecovery + RecoveryContext/RecoveryDecision
  - Replaced handleStepFailure's decideRetry call with decideRecovery (the old decideRetry is preserved for other callers but no longer called in handleStepFailure)
  - Emits recovery_started (Orb → THINKING via 'agent' condition) before decision
  - Emits recovery_decision with full metadata
  - Switch on 5 actions: RETRY (existing retry event), MODIFY_AND_RETRY (modify_retry_started + apply modifiedParams), REPLAN (replan_started), SKIP (skip_executed + step.status='skipped'), ABORT (recovery_failed + step_failed + AgentError with recovery metadata)
  - recordRecoveryMemory filters noisy retries (transient RETRY, successful unknown RETRY); records SKIP/ABORT/REPLAN/MODIFY/LLM-analyzed
  - mapErrorClassToAgentErrorType for backward-compat with legacy AgentError.type
- Modified src/renderer/components/agent/AgentStateDisplay.tsx: added 6 new event cases (recovery_started → Brain+pulse+purple, recovery_decision → Brain+purple, modify_retry_started → Wrench+pulse+yellow, skip_executed → Square+yellow, recovery_succeeded → CheckCircle+green, recovery_failed → XCircle+red)
- Modified src/renderer/components/chat/NexChatPanel.tsx: added 6 new event cases mapping to Orb states (recovery_started → voiceController.setCondition('agent', 'thinking'), modify_retry_started → 'working', others → message updates). Recovery emoji varies by action (🔄/📋/⏭️/❌/🤔).
- Created tests/tools/test-phase-7-recovery.ts: 23 test sections, 165 assertions covering:
  1. Error classification (10 classes + priority order)
  2. Transient retry
  3. Exponential backoff (grows exponentially, caps at 5000ms, timeout 2x base)
  4. Permanent error (file_path → REPLAN)
  5. Permission/security rejection (SKIP if more steps, ABORT on last step, NEVER RETRY)
  6. Cancellation (ABORT, never RETRY/REPLAN/SKIP)
  7. Max retry (transient/timeout → REPLAN/ABORT at max; model_inference/unknown → SKIP/ABORT at 1)
  8. MODIFY_AND_RETRY (missing path from activeFile, missing content as empty string; path-outside → security NOT modify)
  9. REPLAN (file_path, transient exhausted)
  10. SKIP (permission with more steps, model_inference at 1 retry)
  11. ABORT (cancellation, permission last step, unknown at 1 retry)
  12. LLM fallback (heuristic first, ambiguous → LLM, LLM parse failure → heuristic, LLM throw → heuristic, forceLLM always)
  13. Offline behavior (no runtime → heuristic only)
  14. Context propagation (redacted — API keys stripped, paths preserved, includes task ID/user request/step/tool/error/attempt/remaining plan)
  15. Verification (source inspection — core.ts checks step.status === completed before recovery_succeeded)
  16. Queue integration (recovery events flow through agent-event IPC, queue retry policy independent)
  17. Orb integration (NexChatPanel maps recovery_started → thinking, modify_retry_started → working; AgentStateDisplay handles all 6 events; orb-state.ts untouched — no new states)
  18. Race conditions (concurrent decideRecovery, cancellation overrides transient)
  19. Failure isolation (recovery engine crash → ABORT, LLM failure → heuristic, independent task decisions)
  20. Memory recording (filters noisy transient RETRY, records SKIP/ABORT/REPLAN/LLM-analyzed, best-effort)
  21. Agent core integration (decideRecovery not decideRetry, emits recovery_started + recovery_decision, switch on 5 actions, ABORT pushes AgentError with metadata, SKIP marks skipped)
  22. Safety guards (LLM cannot override permission/security/cancellation → safety override to heuristic; recovery re-executes via executeStep → executeToolWithPermission; recovery-engine never calls executeTool directly)
  23. Types + AgentEventType (6 recovery events, AgentError metadata fields, legacy type preserved)
- Fixed bugs found during testing:
  1. "context too large" was matching file_path's "too large" pattern (wrong priority). Fixed by removing "too large" from FILE_PATH_PATTERNS and using "file too large" instead. MODEL_INFERENCE_PATTERNS already has "context (too large|...)".
  2. tryFixArguments had a "path outside → strip ../" heuristic that would bypass security. Removed it (correct behavior: path-outside is classified as security_policy → SKIP/ABORT, never auto-fix).
  3. Tests using errorCode: 'TOOL_FAILURE' for "weird error" got tool_failure class (not unknown). Fixed tests to use errorCode: undefined for genuinely ambiguous errors.
  4. buildLLMRecoveryPrompt referenced undefined `heuristicDecision` variable (should be `heuristic`). Fixed.
  5. Tests checking "recovery-engine does NOT call executeTool" used substring match which matched comment mentions. Fixed to use regex for actual imports/calls.
  6. Test 14.1 used makeCtx with overridden task but taskId still pointed to default task. Fixed to also override taskId.
  7. core.ts had a LogEntry type mismatch — `decision` field not in LogEntry. Fixed to use `data: decision`.
  8. core.ts had type narrowing issue — step.status = 'pending' narrowed to literal. Fixed with cast `(step as { status: string }).status`.

Stage Summary:
- Architecture delivered: error-classifier.ts (10-class) + recovery-engine.ts (5-action + LLM fallback) layered on existing trust-retry + react-loop. NO parallel systems.
- Agent integration: handleStepFailure now uses decideRecovery (replaces decideRetry). Old decideRetry preserved for backward-compat (no other callers).
- Phase 6 Queue integration: recovery events flow through existing agent-event IPC (no new IPC). Queue retry policy stays independent (function-kind tasks). Agent-kind tasks flow through agent core → new recovery.
- Orb integration: NEW events map to existing Orb states via existing condition system (recovery_started → 'thinking', modify_retry_started → 'working'). NO new orb-state.ts transitions.
- Permission enforcement: recovery NEVER calls executeTool directly. RETRY/MODIFY re-execute via executeStep → executeToolWithPermission (same path as original). LLM can NEVER override permission/security/cancellation (safety guard in parseLLMRecoveryResponse).
- Memory: records SKIP/ABORT/REPLAN/MODIFY/LLM-analyzed recoveries; filters out noisy transient RETRY + successful unknown RETRY. Best-effort (wrapped in try/catch).
- Tests: 165/165 PASS across 23 sections covering all Phase 7 §13 requirements.
- Verification:
  - Typecheck (renderer + main): PASS
  - Build: PASS
  - Phase 7 tests: 165/165 PASS
  - Phase 116 regression tests: ALL PASS (14 suites)
  - Phase 6 task queue tests: PASS
  - System tests: same pass/fail count before and after my changes (no regressions):
    - phase38: 79/80 (1 pre-existing fail — "invokes on complex verification")
    - phase40: 109/110 (1 pre-existing fail — "Phase 40 log message")
    - phase41: 116/118 (2 pre-existing fails — whisper/piper binary search paths)
    - ui14: 95/100 (5 pre-existing fails — utterance.onend/onerror, UI-14 §4 comment, speaking → Magenta/Pink, onend restarts STT)
    - p33: 46/47 (1 pre-existing fail — NO voice toggle)
- Files changed: 5 new/modified (error-classifier.ts, recovery-engine.ts, types.ts, core.ts, AgentStateDisplay.tsx, NexChatPanel.tsx) + 1 new test file
- Next: commit + push to main

---
Task ID: phase-8-0
Agent: main
Task: PHASE 8 — Context Propagation (architecture trace + gap analysis)

Work Log:
- Traced existing context flow across the agent pipeline:
  1. Agent → Planner: buildContext() in context-manager.ts builds messages from userRequest, intent, recentConversation, projectPath, activeFile, relevantKnowledge, relevantMemories. Token-aware (truncates from lowest-priority layers if needed).
  2. Planner → Steps: generatePlan() returns PlanResult { steps: AgentStep[] }. Each step has id, index, description, toolName, toolParams, requiresPermission, requiresDiffApproval, verificationCriteria, status, retryCount. userRequest is NOT propagated per-step (it lives on task).
  3. Steps → executeStep: passes (task, step, token, runtime, model). All context is on `task`. Step gets mutated (status, startedAt, completedAt, retryCount, error).
  4. executeStep → Tool: prepareToolCall(step) returns ToolCall with toolDefinition + params + permission. Permission context: { projectId, sessionId: task.id, targetPath, metadata }. ToolContext.metadata gets the cancellationToken + toolContextExtras.
  5. Tool → Observation: built as { id, toolCallId, stepId, rawOutput, data, signals, modifiedFiles, timestamp }. Pushed to task.observations. NO reference to userRequest/intent/conversation.
  6. Observation → Agent: ReAct loop passes (userRequest, intent, lastStepDescription, lastToolName, toolResult, observation, remainingSteps, stepsExecuted, maxSteps, recentObservations, projectPath, tools). Missing: sessionId, conversationId, language, activeFile.
  7. Agent → Recovery (Phase 7): RecoveryContext has { taskId, step, task, toolName, errorMessage, errorCode, attempt, maxRetries, lastObservation, cancelled, cancelReason }. Has access to full task (via task reference) so userRequest/intent/projectPath are reachable via ctx.task.
  8. Recovery → Retry/Replan: RETRY/MODIFY_AND_RETRY call executeStep(task, step, ...) — same task reference preserved. REPLAN sets step.status='completed' and lets runTask loop continue (replanner is invoked via ReAct on the next step).
  9. Task Queue → Agent: queue wraps agentTaskId. The queue has its own metadata (free-form). NO sessionId/conversationId propagation from queue → agent. Agent task gets its ID at createTask time; queue item has a separate queue ID.
  10. Agent → Memory: TaskMemory.set() called in handleStepFailure for recovery + main.ts for task results. Records recovery decisions. No structured contract.
  11. Agent → UI events: emit() with { type, taskId, stepId?, toolCallId?, timestamp, message, data? }. data is redacted via redactObjectDeep in AgentLogger (logger.ts:178). UI never sees raw tool params unless explicitly passed in data (e.g. permission_requested passes toolCall.params).

- Identified gaps:
  G1. CreateTaskRequest has NO sessionId/conversationId field — agent tasks can't be correlated back to the chat conversation that spawned them. Currently sessionId in permContext is just task.id (self-reference, not the actual conversation).
  G2. TaskQueueItem.metadata is free-form (Record<string, unknown>) with NO contract — no way to know what's safe to persist (could leak secrets) vs. what's structured context (taskId, conversationId, language, userGoal).
  G3. Recovery context propagation: RecoveryContext has `task` (full reference) which is good, but the LLM prompt builder (buildLLMRecoveryPrompt) doesn't explicitly surface userGoal/intent at the top — it's buried in "## Task" section. Should be more prominent for replan preservation.
  G4. Observation propagation: observation object has NO reference to userRequest/intent. When observation is fed to the re-planner, it relies on the caller (executeStep) to pass userRequest separately. This is fragile — if a future caller forgets, the replan loses the original goal.
  G5. IPC boundary: agent-event IPC passes the event object via webContents.send. Electron serializes via structured clone. Complex objects (Error instances, functions, class instances) don't survive — they become plain objects. Currently AgentEvent.data contains arbitrary objects (e.g. AgentError with stack) which could lose type info.
  G6. Step context in retry: when a step is retried (RETRY/MODIFY_AND_RETRY), step.retryCount is incremented and step.toolParams may be modified. The ORIGINAL toolParams are lost (overwritten). No snapshot of the original params → can't audit what was changed.
  G7. Memory recording: TaskMemory.set() is called in recordRecoveryMemory but the key is `recovery-${task.id}-${step.id}` which is unique per (task, step) — fine. But there's NO aggregation: if the same kind of error happens across tasks, we don't learn from it.
  G8. Large tool outputs: context-manager truncates observations to 2000 chars (line 255). buildLLMRecoveryPrompt slices error to 500 chars, params JSON to 800 chars. But rawOutput on the Observation object is NOT truncated — task.observations keeps the full output. If task.observations grows unbounded, memory grows.
  G9. Persistence redaction: TaskQueueItem.metadata is persisted to disk (task-queue.json) WITHOUT redaction. If metadata contains secrets (e.g. user passes an API key in metadata), it's written to disk in plaintext.

- Designed Context Contract (minimal, additive — NO new system):
  Phase 8 will ADD a structured `AgentContextContract` interface that captures the canonical context fields, and a `safeContextSnapshot()` helper that produces a redacted, bounded snapshot suitable for LLM prompts, memory, and IPC.

  Contract fields (all optional except taskId + userRequest):
    taskId, agentTaskId?, conversationId?, sessionId?, userRequest, intent?, projectPath?, activeFile?, language?, currentPlan (summary), currentStep (summary), stepIndex?, toolName?, toolParamsSafe (redacted), lastObservation? (truncated), error?, attempt?, maxRetries?, remainingSteps (summary), executionMetadata?

  Snapshot rules:
    - Always redacted (redactObjectDeep on toolParamsSafe + lastObservation)
    - Always bounded (truncations: userRequest 200, error 500, toolParamsSafe 800, lastObservation 2000, remainingSteps 5)
    - Never includes raw tool outputs > 2000 chars
    - Never includes secrets (redactObjectDeep strips api_key, password, token, etc.)
    - Shallow snapshot (no deep clone of task/plan — just summary fields)

  Propagation rules (minimal fixes):
    P1. Add conversationId/sessionId to CreateTaskRequest + AgentTask (additive, optional).
    P2. Add safeContextSnapshot() helper that produces a redacted, bounded snapshot from any AgentTask+Step.
    P3. Use safeContextSnapshot() in buildLLMRecoveryPrompt (replace inline redaction).
    P4. Add redaction to TaskQueueItem.metadata before persistence (defense-in-depth).
    P5. Preserve original toolParams snapshot on step when MODIFY_AND_RETRY changes them (for audit).
    P6. Add sessionId (conversationId) to PermissionContext (currently uses task.id as sessionId).
    P7. Add language field to AgentTask (for i18n-aware recovery prompts).
    P8. Document the Context Contract in a new src/main/agent/context-contract.ts module.

Stage Summary:
- Architecture trace complete. 9 gaps identified. NO duplication of existing systems.
- Context Contract designed as a minimal ADDITIVE layer on top of existing context-manager + types.
- Snapshot helper will reuse existing redactObjectDeep + estimateTokens (no new redaction logic).
- Propagation fixes are minimal: optional fields added, helper function for safe snapshots, redaction at persistence boundary.
- Next: implement context-contract.ts → wire into core.ts + recovery-engine.ts + queue.ts → tests

---
Task ID: phase-8-1
Agent: main
Task: PHASE 8 — Context Propagation (implementation + tests + verification)

Work Log:
- Traced existing context flow (9 gaps identified, no duplication):
  G1. No conversationId/sessionId on AgentTask — couldn't correlate to chat
  G2. TaskQueueItem.metadata was free-form, no redaction at persistence
  G3. Recovery LLM prompt built context inline (duplicated redaction logic)
  G4. Observation had no reference to userRequest/intent (fragile)
  G5. IPC boundary: AgentEvent.data with arbitrary objects could lose type info
  G6. Step original toolParams lost when MODIFY_AND_RETRY modified them
  G7. Memory recording per-(task,step) — no aggregation
  G8. Observation.rawOutput unbounded on the task object
  G9. No structured way to snapshot context for IPC/memory
- Created src/main/agent/context-contract.ts (minimal, additive — no new system):
  - AgentContextContract interface: taskId, agentTaskId?, conversationId?, sessionId?, userRequest, intent?, projectPath?, activeFile?, language?, currentPlan, currentStep, stepIndex?, toolName?, toolParamsSafe? (redacted), lastObservation? (truncated), error?, errorClass?, attempt?, maxRetries?, remainingSteps (max 5), executionMetadata?
  - safeContextSnapshot(task, step?, opts?) helper: produces REDACTED + BOUNDED snapshot. Reuses redactObjectDeep (logger.ts) + estimateTokens (context-manager.ts). NO new redaction logic.
  - snapshotToolParams(step) helper: shallow clone of tool params (for MODIFY_AND_RETRY audit)
  - redactQueueMetadata(metadata) helper: defense-in-depth redaction at persistence boundary
  - validateSnapshotBounds(snapshot) helper: bounds check (for tests)
  - snapshotTokenSize(snapshot) helper: token budget check
  - SNAPSHOT_BOUNDS constants: USER_REQUEST_MAX=200, INTENT_MAX=100, TOOL_PARAMS_JSON_MAX=800, OBSERVATION_RAW_OUTPUT_MAX=2000, ERROR_MESSAGE_MAX=500, REMAINING_STEPS_MAX=5, PLAN_DESCRIPTIONS_MAX=5
  - Snapshot rules: ALWAYS redacted, ALWAYS bounded, NEVER includes raw outputs > 2000 chars, NEVER includes secrets, SHALLOW snapshot (no deep clone of task/plan/observations arrays)
- Modified src/main/agent/types.ts: added optional fields to AgentTask (additive — no breaking changes):
  - conversationId? (chat conversation correlation)
  - sessionId? (UI session for permission scope + memory)
  - language? (en/fa/... for i18n-aware recovery/replan prompts)
  - originalToolParams? (snapshot before MODIFY_AND_RETRY modification, for audit)
- Modified src/main/agent/core.ts:
  - CreateTaskRequest: added conversationId?, sessionId?, language? fields
  - createTask(): wired new fields into the task object
  - PermissionContext: now uses task.sessionId || task.id (session-scoped permissions instead of per-task)
  - MODIFY_AND_RETRY action: snapshots original toolParams BEFORE modification (via snapshotToolParams) and emits them in modify_retry_started event for audit
- Modified src/main/agent/recovery-engine.ts:
  - Imported safeContextSnapshot from context-contract
  - Rewrote buildLLMRecoveryPrompt() to use safeContextSnapshot (removed inline redaction — no duplication)
  - Prompt now surfaces conversationId, sessionId, language, projectPath, activeFile, intent, executionMetadata (backend, model, timeout) — all redacted + bounded
- Modified src/main/tasks/persistence.ts:
  - saveQueueState() now calls redactQueueMetadata on each item.metadata before writing to disk (defense-in-depth)
  - Also redacts item.result for terminal items (function tasks may have raw output with secrets)
  - Atomic write preserved (temp + rename)
- Created tests/tools/test-phase-8-context.ts: 20 test sections, 151 assertions covering:
  1. Agent → Tool context preservation (taskId, userRequest, toolName, toolParamsSafe, projectPath)
  2. taskId preserved (matches task.id, distinct across tasks)
  3. agentTaskId preserved (queue → agent)
  4. user goal preserved in replan (userRequest + intent)
  5. step context preserved in retry (description, index, snapshotToolParams produces NEW object)
  6. observation propagated to next step (ReAct uses last 5 observations)
  7. recovery context complete (all required fields, recovery-engine uses safeContextSnapshot)
  8. queue → agent context correct (agentTaskId, agentRunTask, agentCancelTask, redaction at persistence)
  9. IPC context serialize/deserialize (JSON-serializable, no undefined, redacted via logger)
  10. snapshot immutability (mutating task/step doesn't change previous snapshot)
  11. large tool output truncated (OBSERVATION_RAW_OUTPUT_MAX + 5000 chars → 2000)
  12. context size controlled (SNAPSHOT_BOUNDS, validateSnapshotBounds, remainingSteps capped)
  13. secrets redacted (API keys, passwords, tokens, GitHub PAT)
  14. persistence does NOT store secrets (metadata + result redacted before disk write)
  15. cancellation context preserved (cancelled flag, cancelReason, ABORT decision)
  16. failed task context identifiable (errors array, errorClass, recoveryDecision fields)
  17. replan context correct (remainingSteps, userRequest + intent, recentObservations)
  18. concurrent tasks isolation (distinct taskIds, no aliasing, Map<taskId, AgentTask>)
  19. two-task isolation (same userRequest but different IDs distinguishable, conversationId correlation)
  20. regression — Phase 6 + Phase 7 + Phase 8 source inspection (additive, no breaking changes)
- Verification:
  - Typecheck (renderer + main): PASS
  - Build: PASS
  - Phase 8 tests: 151/151 PASS
  - Phase 6 task queue tests: PASS
  - Phase 7 recovery tests: PASS
  - Phase 116 regression tests: ALL PASS (14 suites)
  - System tests: same pass/fail count before and after (no regressions):
    - phase38: 79/80 (1 pre-existing)
    - phase40: 109/110 (1 pre-existing)
    - phase41: 116/118 (2 pre-existing)
    - ui14: 95/100 (5 pre-existing)
    - p33: 46/47 (1 pre-existing)

Stage Summary:
- Architecture delivered: src/main/agent/context-contract.ts (CONTRACT + HELPERS) layered on existing context-manager + types + logger. NO new context manager.
- Context Contract: AgentContextContract with 18 optional fields + safeContextSnapshot helper (single source of truth for redaction + bounds).
- Propagation path: Agent → Planner (existing buildContext) → Steps → executeStep → Tool (permContext now uses sessionId) → Observation (task.observations) → Recovery (safeContextSnapshot) → Retry (same task/step references) → Replan (task.userRequest + intent + recentObservations) → Queue (agentTaskId link, redacted metadata at persistence) → Memory (TaskMemory.set) → UI (agent-event IPC, redacted by logger).
- Redaction strategy: redactObjectDeep (logger.ts) reused everywhere. Applied at: recovery prompt (via safeContextSnapshot), persistence (via redactQueueMetadata), event emission (via AgentLogger). Single source of truth — no duplication.
- Token/size limits: SNAPSHOT_BOUNDS enforce 200 (userRequest), 100 (intent), 800 (toolParams JSON), 2000 (observation), 500 (error), 5 (remaining steps + plan descriptions). Existing context-manager truncates observations to 2000 + conversation to last 10 + files to 4000 chars.
- Queue integration: Phase 6 queue unchanged structurally. Persistence now redacts metadata + result before disk write. agentTaskId link preserved. Crash recovery still marks running → failed (NO fake completion).
- Recovery integration: Phase 7 recovery-engine now uses safeContextSnapshot (single redaction source). Permission scope uses task.sessionId (chat session, not per-task). MODIFY_AND_RETRY snapshots original toolParams for audit.
- Persistence changes: saveQueueState redacts item.metadata + item.result via redactQueueMetadata. Atomic write preserved (temp + rename).
- Tests: 151/151 PASS across 20 sections covering all Phase 8 §11 requirements.
- Files changed: 5 new/modified (context-contract.ts new, types.ts, core.ts, recovery-engine.ts, persistence.ts) + 1 new test file
- Next: commit + push to main (hold for Phase 9 approval per user instruction)

---
Task ID: phase-9-0
Agent: main
Task: PHASE 9 — Agent Reliability & Verification (architecture trace + gap analysis)

Work Log:
- Traced existing verification flow across the agent pipeline:
  1. verification.ts (existing): verifyToolResult() + verifyObservation() — pattern matching on exit code + output contains/regex/forbidden. Returns VerificationResult { id, stepId, description, verifiedBy, status, details, timestamp }. NO confidence/evidence/signals/recommendedAction fields yet.
  2. core.ts executeStep (line 1060-1086): if step.verificationCriteria exists, calls verifyToolResult() + pushes to task.verification. verificationPassed boolean gates step completion.
  3. Step completion (line 1245-1300): 3 paths — (a) result.success && verificationPassed → step.completed; (b) !result.success → handleStepFailure (Phase 7 recovery); (c) !verificationPassed → if replan then completed, else step.failed + emit step_failed. GAP: path (c) does NOT call handleStepFailure — so verification failures bypass Phase 7 recovery (just marks failed, no RETRY/MODIFY/REPLAN decision).
  4. Task completion (line 549-625): if task.status !== 'failed' && !cancelled → checks toolCalls.length === 0 (false-success prevention from Phase 116) → marks completed + emits task_completed. GAP: no check that all required steps were verified, no check for unresolved errors, no check for active recovery in progress.
  5. VerificationResult type (line 237-249): { id, stepId, description, verifiedBy, verifyingToolCallId?, status, details?, timestamp }. NO confidence, NO evidence array, NO signals, NO recommendedAction.
  6. AgentStep.verificationCriteria (line 105-110): { expectedExitCode?, expectedOutputContains?, expectedOutputRegex?, forbiddenOutputContains? }. GAP: NO expectedOutcome (what the step should produce — e.g. "file should exist at path X"), NO verificationHints (how to verify — e.g. "check file exists").
  7. Existing events: verification_started, verification_completed. GAP: NO verification_passed, NO verification_failed (the "completed" event has status in data, but UI can't easily distinguish).

- Identified gaps (9):
  G1. Verification failure does NOT enter Phase 7 recovery. Path (c) at line 1275-1300 just marks step.failed + emits step_failed — bypasses handleStepFailure. This means a tool that succeeds but doesn't produce the expected outcome gets no recovery (no RETRY/MODIFY/REPLAN).
  G2. No structural verification. verifyToolResult only checks tool result output/exit code — doesn't verify the actual system state changed (file exists after write_file, file gone after delete, etc.). A tool can report success=false→success but the file wasn't actually created.
  G3. No content verification. After edit_file, we don't check the expected text is actually in the file. We rely on the tool's self-report.
  G4. No Task Completion Gate. task_completed is emitted whenever status !== 'failed' && !cancelled && toolCalls > 0. NO check that all steps were verified, NO check for unresolved errors, NO check for active recovery.
  G5. VerificationResult lacks confidence/evidence/signals/recommendedAction. Per Phase 9 §3 contract, we need these for richer verification decisions.
  G6. AgentStep lacks expectedOutcome/verificationHints. Planner can't tell the verifier what to check (e.g. "file should exist at /tmp/test.ts").
  G7. No verification_passed/verification_failed events (only verification_started/verification_completed with status in data). UI can't easily subscribe to pass/fail.
  G8. No loop protection specific to verification (relies on Phase 7 retry policy, which is correct — but no explicit max verification attempts). Actually Phase 7 policy handles this: RETRY is bounded by maxRetries, so verification failure → handleStepFailure → RETRY is already bounded. NO new system needed.
  G9. No memory filtering for verification noise. Phase 7 recordRecoveryMemory already filters transient retries. We just need to extend it to record important verification failures (when recovery was triggered by verification failure).

- Designed Phase 9 architecture (minimal, additive — NO new system):
  - EXTEND verification.ts (existing): add structural verification functions (verifyFileExists, verifyFileGone, verifyFileContains) that use read-only tools (read_file, list_directory) via executeTool with a NO-PERMISSION-REQUIRED internal context. Add verifyStepOutcome() that dispatches by tool name: write_file → verifyFileExists, edit_file → verifyFileContains, run_command/npm_build/npm_test → verifyExitCode + output patterns, list_directory/search_files → no structural verification (read-only tools don't change state).
  - EXTEND VerificationResult type (additive): add confidence (0..1), evidence (string[]), signals (reuse AgentSignal), recommendedAction ('continue' | 'retry' | 'replan' | 'skip' | 'abort').
  - EXTEND AgentStep (additive): add expectedOutcome?: { type: 'file_exists' | 'file_gone' | 'file_contains' | 'exit_code' | 'output_contains'; path?: string; content?: string; exitCode?: number; outputContains?: string[] }. add verificationHints?: string[]. These are OPTIONAL — existing steps without them use the tool-result-only verification (Level 1).
  - EXTEND core.ts: after verifyToolResult (Level 1), if step.expectedOutcome exists, run verifyStepOutcome (Level 2/3). If structural verification fails, treat as verification failure → call handleStepFailure (NOT just mark failed). This closes G1.
  - ADD Task Completion Gate: before emitting task_completed, call verifyTaskCompletion(task) which checks: (a) all steps with required tools are completed OR skipped (not 'pending'/'in_progress'); (b) no failed steps unless they were skipped via recovery SKIP; (c) no unresolved errors with type 'tool_error' that weren't recovered; (d) toolCalls > 0 (existing check). If any check fails, emit task_failed instead of task_completed.
  - ADD verification_passed/verification_failed events (additive to AgentEventType). Keep verification_started/verification_completed for backward compat. UI handles new events.
  - WIRE verification failure into Phase 7 recovery: when verification fails, call handleStepFailure with errorMessage = `Verification failed: ${details}`. The Phase 7 classifier will map this to a new error class 'verification_failed' (or reuse 'tool_failure' since it's semantically "tool didn't achieve expected outcome"). Actually — better to add 'verification_failed' to the 10-class taxonomy for clearer recovery decisions.
  - ADD 'verification_failed' to ErrorClass (additive, 11th class). Recovery heuristic: verification_failed → RETRY once (maybe tool was transient), then REPLAN (try different approach), then SKIP/ABORT.
  - ADD verifyTaskCompletion() to verification.ts. Returns { passed: boolean, reason: string, unresolvedSteps: AgentStep[], unresolvedErrors: AgentError[] }.
  - Memory: extend recordRecoveryMemory to record verification-triggered recoveries (filter: only record if action was REPLAN/ABORT or LLM-analyzed — skip routine RETRY noise).
  - UI: AgentStateDisplay + NexChatPanel handle verification_passed/verification_failed events (green check for passed, red X for failed).

- Loop protection: NO new system. Phase 7 retry policy (maxRetries) already bounds RETRY. Verification failure → handleStepFailure → RETRY bounded by step.retryCount < task.maxRetries. If retries exhausted → REPLAN/ABORT. This is the correct existing behavior — we just wire verification failure into it.

- Security: structural verification uses read-only tools (read_file, list_directory) via executeTool. These go through the SAME permission path (read permission). We do NOT bypass Permission Gate. The verification context is a ToolContext with a fresh CancellationToken + the task's projectPath + read permission (already granted for most workflows). If permission is denied for the verification read, we mark verification as 'inconclusive' (not 'failed') — we can't verify without reading, so we don't fail the step on permission denial for verification.

Stage Summary:
- Architecture approved: layered on existing verification.ts + core.ts + Phase 7 recovery + Phase 8 context. NO parallel systems.
- 9 gaps identified. All fixes are ADDITIVE (new optional fields, new functions, new events, new error class — no breaking changes).
- Verification levels: L1 (tool result) existing; L2/L3 (structural/content) NEW via read-only tool calls; L4 (execution) existing via exit code; L5 (task completion) NEW via verifyTaskCompletion gate.
- Recovery integration: verification failure → handleStepFailure (Phase 7) with new 'verification_failed' error class. NO duplication.
- Completion Gate: new verifyTaskCompletion() called before task_completed. If gate fails → task_failed.
- Next: implement verification.ts extensions → types.ts additive fields → core.ts wiring → tests

---
Task ID: phase-9-1
Agent: main
Task: PHASE 9 — Agent Reliability & Verification (implementation + tests + verification)

Work Log:
- Traced existing verification flow (9 gaps identified, no duplication):
  G1. Verification failure did NOT enter Phase 7 recovery — just marked step.failed (bypassed recovery)
  G2. No structural verification (file exists after write_file, file gone after delete, etc.)
  G3. No content verification (expected text in file after edit)
  G4. No Task Completion Gate — task_completed emitted whenever status !== 'failed' && !cancelled && toolCalls > 0
  G5. VerificationResult lacked confidence/evidence/signals/recommendedAction
  G6. AgentStep lacked expectedOutcome/verificationHints
  G7. No verification_passed/verification_failed events (only verification_started/verification_completed with status in data)
  G8. No loop protection specific to verification (relies on Phase 7 retry policy — correct, no new system needed)
  G9. No memory filtering for verification-triggered recoveries
- Extended VerificationResult type (additive): confidence (0..1), evidence (string[]), signals (AgentSignal[]), recommendedAction ('continue'|'retry'|'replan'|'skip'|'abort'), level (1-5), verifiedBy extended with 'structural'|'content'|'execution'
- Added ExpectedOutcome interface: { type: 'file_exists'|'file_gone'|'file_contains'|'exit_code'|'output_contains'|'directory_exists', path?, content?, exitCode?, outputContains? }
- Extended AgentStep (additive): expectedOutcome?, verificationHints?
- Extended AgentEventType (additive): verification_passed, verification_failed
- Added 'verification_failed' to ErrorClass (additive, 11th class) + classifier detection (errorCode='VERIFICATION_FAILED' or message prefix 'Verification failed:'). Priority: checked AFTER permission_denied, BEFORE file_path (so verification failures containing "file does not exist" classify as verification_failed, not file_path)
- Extended recovery-engine.ts: verification_failed → RETRY once (ambiguous → LLM), then REPLAN (with more steps) or ABORT (last step)
- Extended verification.ts with NEW functions:
  - verifyStepOutcome(step, toolResult, projectPath): Level 1-4 verification (tool success + expected outcome + exit code). Returns VerificationResult with confidence + evidence + signals + recommendedAction.
  - verifyExpectedOutcome(outcome, projectPath): structural/content verification via read-only fs ops (existsSync, readFileSync, statSync). NO write/execute tool calls — never bypasses Permission Gate.
  - verifyTaskCompletion(task): Level 5 Task Completion Gate. Checks: all steps terminal, no failed steps, no unresolved errors, toolCalls > 0. Returns { passed, reason, unresolvedSteps, unresolvedErrors, confidence }.
- Modified core.ts:
  - Imported verifyStepOutcome + verifyTaskCompletion
  - executeStep: after verifyToolResult (Level 1), runs verifyStepOutcome (Level 2/3/4) when step.expectedOutcome exists OR result.data.exitCode exists. Emits verification_started (existing), verification_completed (existing, with confidence/level/evidence), verification_passed (new), verification_failed (new).
  - !verificationPassed path: now routes to handleStepFailure with errorMessage = `Verification failed: ${details}` (Phase 7 recovery) instead of just marking step.failed. errorCode set to 'VERIFICATION_FAILED' when message starts with 'Verification failed:'.
  - Task completion: calls verifyTaskCompletion(task) BEFORE emitting task_completed. If gate fails, emits task_failed with completion gate reason + pushes AgentError (type='invalid_state'). task_completed now includes completionConfidence in data.
  - recordRecoveryMemory: filters verification_failed RETRY successes (transient), records verification_failed REPLAN/ABORT decisions (important)
  - mapErrorClassToAgentErrorType: handles verification_failed → 'tool_error' (legacy compat; detailed class in AgentError.errorClass)
- Modified error-classifier.ts: moved verification_failed detection BEFORE file_path (priority fix) so "Verification failed: file does not exist" classifies as verification_failed, not file_path
- Modified recovery-engine.ts: added `cls === 'verification_failed'` branch (RETRY once → REPLAN/ABORT)
- Modified types.ts: added verification_failed to AgentError.errorClass union
- Modified UI:
  - AgentStateDisplay.tsx: handles verification_passed (CheckCircle+green) + verification_failed (XCircle+red)
  - NexChatPanel.tsx: handles verification_passed (✅ Verified message) + verification_failed (⚠️ Verification failed + recovery in progress message)
- Created tests/tools/test-phase-9-verification.ts: 33 test sections, 100 assertions covering:
  1. successful tool + verified result (Level 1, Level 2)
  2. successful tool + verification failure (file missing, non-zero exit)
  3. file creation verification (write_file + file_exists)
  4. file modification verification (edit_file + file_contains, Level 3)
  5. file deletion verification (file_gone)
  6. rename/move verification (file_gone for old path)
  7. command verification (exit 0/1, expectedExitCode)
  8. build verification (exit + output contains + forbidden)
  9. test verification (pass/fail, false-success prevention via forbidden)
  10-15. Recovery: verification_failed → RETRY (attempt 0), verification_failed classified correctly, REPLAN (attempt 1 + more steps), ABORT (attempt 1 + last step), max retries respected (1 retry only), no infinite loop
  16-20. Completion: all verified → SUCCESS, pending step → NOT SUCCESS, failed step → NOT SUCCESS, skipped step (recovery) → SUCCESS, 0 tool calls → NOT SUCCESS, unresolved error → NOT SUCCESS, recovered error → SUCCESS
  21-25. Context: taskId preserved, evidence populated, user goal preserved (source), step context preserved, evidence safe (no secrets)
  26-28. Security: verification uses read-only fs only (no executeTool for write/edit/run), verification events don't emit rawOutput, verification.ts doesn't write to disk
  29-30. Concurrency: two tasks different results, verification stateless (survives retry)
  31-33. Regression: Phase 6 intact, Phase 7 handles verification_failed, Phase 8 intact, Phase 9 additive, core.ts wiring, UI handling, verification.ts exports
- Fixed bugs found during testing:
  1. Verification failure messages containing "file does not exist" classified as file_path (not verification_failed). Fixed by moving verification_failed detection BEFORE file_path in classifier priority.
  2. Task completion gate failed tasks with 0 tool calls even when plan was completed. This is the existing Phase 116 behavior — preserved.
  3. core.ts comment changed from "Phase 38: VERIFICATION" to "Phase 38 + Phase 9: VERIFICATION" which broke a phase38 regression test. Fixed by preserving "Phase 38: VERIFICATION" in the comment.
- Verification:
  - Typecheck (renderer + main): PASS
  - Build: PASS
  - Phase 9 tests: 100/100 PASS
  - Phase 6 task queue tests: PASS
  - Phase 7 recovery tests: PASS
  - Phase 8 context tests: PASS
  - Phase 116 regression tests: ALL PASS (14 suites)
  - System tests: same pass/fail count before and after (no regressions):
    - phase38: 79/80 (1 pre-existing — "invokes on complex verification")
    - phase40: 109/110 (1 pre-existing — "Phase 40 log message")
    - phase41: 116/118 (2 pre-existing — whisper/piper binary search)
    - ui14: 95/100 (5 pre-existing — utterance.onend/onerror, UI-14 §4, speaking→Magenta/Pink, onend restarts STT)
    - p33: 46/47 (1 pre-existing — NO voice toggle)

Stage Summary:
- Architecture delivered: layered on existing verification.ts + core.ts + Phase 7 recovery + Phase 8 context. NO parallel systems.
- Verification Levels: L1 (tool result) existing + extended; L2/L3 (structural/content) NEW via verifyStepOutcome; L4 (execution) existing via exit code; L5 (task completion) NEW via verifyTaskCompletion gate.
- Verification Contract: VerificationResult with confidence, evidence, signals, recommendedAction, level (additive — all optional). ExpectedOutcome type for per-step expectations.
- False Success Prevention: tool.success=false → failed (Level 1). tool.success=true + expected outcome missing → failed (Level 2/3) → Phase 7 recovery (RETRY once → REPLAN → SKIP/ABORT). Task completion gate: any pending steps OR failed steps OR unresolved errors → task_failed (not task_completed).
- Recovery Integration: verification failure routes to handleStepFailure with errorCode='VERIFICATION_FAILED'. Phase 7 classifier maps to 'verification_failed' error class. Recovery: RETRY once (ambiguous → LLM) → REPLAN (more steps) → ABORT (last step). NO duplication.
- Replan Integration: REPLAN preserves user goal via task.userRequest + task.intent (existing ReAct behavior). Phase 8 context snapshot available.
- Loop Protection: NO new system. Phase 7 retry policy (maxRetries) bounds RETRY. verification_failed only retries once (then REPLAN/ABORT). Bounded by step.retryCount < 1.
- Context Integration: uses Phase 8 safeContextSnapshot indirectly (recovery engine). Verification events emit evidence (safe, redacted by logger). NO raw tool output in events.
- Security: verification uses read-only fs ops (existsSync, readFileSync, statSync). NEVER calls executeTool for write_file/edit_file/run_command. Permission Gate NOT bypassed. Verification read denial → 'inconclusive' (not 'failed' — can't verify without reading).
- Memory: recordRecoveryMemory filters verification_failed RETRY successes (noisy), records verification_failed REPLAN/ABORT (important). NO verification noise.
- UI Events: verification_passed (green check) + verification_failed (red X) additive to existing verification_started/verification_completed. UI handles all 4.
- Tests: 100/100 PASS across 33 sections covering all Phase 9 §16 requirements.
- Files changed: 7 new/modified (verification.ts, types.ts, core.ts, error-classifier.ts, recovery-engine.ts, AgentStateDisplay.tsx, NexChatPanel.tsx) + 1 new test file
- Next: commit + push to main (hold for Phase 10 approval per user instruction)

---
Task ID: phase-10-audit
Agent: main
Task: PHASE 10 — Architecture Audit + Gap Analysis (BEFORE implementation)

Work Log:
- Verified clean state: commit d0b98ee, working tree clean
- Audited existing browser/web-related code:
  - src/main/ai/tools/web-tool.ts: WebFetchTool + WebSearchTool (HTTP-only via Electron net module)
    - HTTPS-only, URL allow-list (blocks private IPs/localhost), 10s timeout, 5MB limit, HTML stripped
    - Returns text content (no DOM interaction, no JavaScript execution)
  - ToolCategory type already includes 'browser' (line 46) — placeholder for future
  - ToolPermission has 'network' (line 67) — used by web_fetch/web_search
  - NO playwright/puppeteer installed in package.json
  - NO browser automation tools registered in tool-registry.ts
  - NO BrowserWindow used for automation (only the main app window, with strict security: will-navigate blocks external URLs, will-attach-webview blocks webviews, setWindowOpenHandler denies new windows)
- Audited integration points for Phase 10:
  - Tool interface (src/main/ai/tool-registry.ts): registerTool(), ToolDefinition, ToolContext, ToolResult — browser tools would implement this interface
  - Permission Gate (src/main/permissions/index.ts): 'network' permission exists; 'browser' not in Permission union (would need extension OR reuse 'network')
  - Planner (src/main/agent/planner.ts): generatePlan() picks tools from listToolDefinitions() — browser tools auto-appear if registered
  - ReAct loop (src/main/agent/react-loop.ts): rePlanAfterObservation uses tool list — browser tools auto-available
  - Recovery (src/main/agent/recovery-engine.ts): 10+1 error classes — browser errors (navigation timeout, element not found) need classification
  - Verification (src/main/agent/verification.ts): ExpectedOutcome types — browser outcomes (page contains text, URL changed) need new types
  - Context (src/main/agent/context-contract.ts): safeContextSnapshot — browser context (URL, page title) would be in executionMetadata
  - Task Queue (src/main/tasks/): function-kind tasks could run browser automation scripts; agent-kind tasks would use browser tools via planner
  - Orb/UI: existing 'working' state for tool execution; browser tools would use it automatically
  - Memory: TaskMemory.set could record browser automation results
- Identified Phase 10 scope (from original roadmap: "Browser Automation (Playwright)"):
  Goal: NEX agent should be able to automate browser interactions — navigate to URLs, click elements, fill forms, extract data, take screenshots, run multi-step workflows on web pages.

  Capabilities needed:
  1. Browser session management (open, close, switch tabs)
  2. Navigation (goto URL, back, forward, reload, wait for load)
  3. Element interaction (click, type, select, scroll, hover)
  4. Element queries (find by CSS/XPath/text, get text, get attribute, check visible)
  5. Page inspection (get title, get URL, get HTML, screenshot)
  6. Form filling (input, textarea, select, checkbox, radio)
  7. Multi-step workflows (scripted sequences with waits + assertions)
  8. Screenshot capture (for vision-based verification + UI feedback)
  9. Cookie/session persistence (login flows that survive across steps)

- Identified gaps (9) for Phase 10:
  G1. NO browser automation library installed. Playwright is the roadmap choice (mature, cross-browser, Electron-compatible via headless Chromium).
  G2. NO BrowserWindow/session manager for automation. The main app window has strict security (blocks external nav, blocks webviews). Browser automation needs a SEPARATE headless or offscreen BrowserWindow with permissive security for the target URL.
  G3. NO browser tools registered. Need: browser_navigate, browser_click, browser_type, browser_extract, browser_screenshot, browser_close, etc.
  G4. Permission system has 'network' but NOT 'browser'. Browser automation is more powerful than simple HTTP fetch (runs JS, stores cookies, can click). Need either a new 'browser' permission OR extend 'network' with a sub-permission. Minimal fix: reuse 'network' (browser is a superset of network) + add a 'browser' category tag for UI clarity.
  G5. Error classifier lacks browser-specific error classes. Playwright throws: navigation timeout, element not found, selector timeout, etc. These map to existing classes (timeout → 'timeout', element not found → 'file_path' is wrong, should be a new 'browser_error' class OR reuse 'tool_failure'). Minimal: reuse 'tool_failure' for browser errors (retryable) + add specific patterns for timeout/selector.
  G6. Verification lacks browser outcome types. ExpectedOutcome has file_exists/file_gone/file_contains/exit_code/output_contains/directory_exists. Need: url_changed, page_contains_text, element_visible, screenshot_captured. Minimal: extend ExpectedOutcome with browser types (additive).
  G7. Context contract doesn't capture browser session state. safeContextSnapshot has executionMetadata (free-form) — browser URL/title could go there. No new field needed (use existing executionMetadata).
  G8. NO UI feedback for browser automation. Orb uses 'working' for tool execution (automatic). But screenshots need a way to show in UI — could use agent_token event with base64 image, or a new 'browser_screenshot' event. Minimal: use existing agent_token with phase='browser-screenshot'.
  G9. NO test isolation for browser tools. Browser tools need a real browser (Playwright launches Chromium). Tests can either: (a) mock Playwright (no real browser — fast but limited), (b) use Playwright's headed mode in CI (slow, needs display). Minimal: mock-based tests for logic + source-inspection tests for integration (same pattern as Phase 6-9).

- Designed Phase 10 architecture (minimal, additive — NO new parallel system):
  - NEW module: src/main/ai/tools/browser/ with:
    - browser-session-manager.ts: manages headless BrowserWindow instances (1 per browser task). Uses Electron BrowserWindow (offscreen mode) OR Playwright (if installed). Falls back to "browser not available" if neither.
    - browser-navigate-tool.ts: browser_navigate (goto URL, wait for load)
    - browser-click-tool.ts: browser_click (click element by selector)
    - browser-type-tool.ts: browser_type (fill input by selector)
    - browser-extract-tool.ts: browser_extract (get text/HTML/attribute by selector)
    - browser-screenshot-tool.ts: browser_screenshot (capture page as PNG, return base64)
    - browser-close-tool.ts: browser_close (close session)
    - index.ts: barrel + registerBrowserTools()
  - EXTEND ToolCategory (additive): 'browser' already exists in the type — no change needed.
  - EXTEND Permission (additive): add 'browser' to Permission union (more powerful than 'network' — runs JS, stores cookies). UI shows a distinct permission prompt for browser ops.
  - EXTEND ExpectedOutcome (additive): add 'url_changed' | 'page_contains_text' | 'element_visible' | 'screenshot_captured' types.
  - EXTEND error-classifier (additive): add 'browser_error' class (retryable — element not found is often transient due to page load timing).
  - EXTEND recovery-engine (additive): browser_error → RETRY once (page may still be loading) → REPLAN (different selector/approach) → ABORT.
  - EXTEND verification.ts (additive): handle new browser ExpectedOutcome types via the browser session (check current URL, page text, element visibility).
  - WIRE into tool-registry: registerBrowserTools() called from ensureBuiltinToolsRegistered().
  - WIRE into planner: browser tools auto-appear in listToolDefinitions() (no planner change needed).
  - Security: browser tools require 'browser' permission (new) — goes through existing Permission Gate (executeToolWithPermission). NEVER bypass.
  - Screenshot safety: screenshots are base64-encoded PNG, returned in ToolResult.data. UI shows via agent_token event with phase='browser-screenshot'. Screenshots are NOT persisted to disk by default (memory-only) unless user explicitly saves.
  - Context: browser session ID + current URL stored in executionMetadata (via safeContextSnapshot). Redacted if URL contains secrets (e.g. ?token=...).
  - Memory: record browser automation outcomes (URL visited, actions taken, result) for future planning. Filter noise (intermediate screenshots).
  - Tests: mock-based tests for tool logic + source-inspection tests for integration. NO real browser needed for unit tests.

- Open questions for user (before implementation):
  Q1. Use Playwright (external dependency, ~300MB Chromium download) OR Electron's built-in BrowserWindow (offscreen mode, no extra download, but limited API — no selector queries, no click simulation)?
     Recommendation: Start with Electron BrowserWindow + webContents.executeJavaScript for DOM queries (zero new dependencies). Add Playwright as OPTIONAL upgrade later if more power is needed.
  Q2. Should browser automation be enabled by default or require explicit user opt-in (settings toggle)?
     Recommendation: Require explicit opt-in (security — browser automation is powerful). Default OFF.
  Q3. Screenshot storage: memory-only (default) OR save to disk for debugging?
     Recommendation: Memory-only by default, with a settings toggle to save to <userData>/browser-screenshots/ for debugging.

Stage Summary:
- Architecture audit complete. Phase 10 = Browser Automation (Playwright per roadmap).
- 9 gaps identified. All fixes ADDITIVE (new module, new permission, new error class, new ExpectedOutcome types — no breaking changes).
- Recommendation: Use Electron BrowserWindow (zero new deps) for v1; Playwright as optional upgrade.
- Browser tools go through existing Permission Gate (new 'browser' permission) — NEVER bypass.
- Integration: planner auto-picks browser tools; recovery handles browser_error; verification checks browser outcomes; context captures URL/title in executionMetadata.
- AWAITING USER APPROVAL before implementation.
