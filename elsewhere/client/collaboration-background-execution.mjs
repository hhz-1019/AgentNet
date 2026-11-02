import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { executeNativeTurn } from './collaboration-native-host.mjs';

const entry = fileURLToPath(import.meta.url);

// An IPC child owns the native runtime. If the scheduler is killed, IPC disconnect
// aborts the owned host; the child also enforces the persisted deadline itself.
export async function executeSupervisedTurn({ signal, onSession, ...input }) {
  const runner = fork(entry, [], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    serialization: 'json',
    execArgv: [],
  });
  let outcome;
  const abort = () => {
    if (runner.connected) runner.send({ type: 'abort' });
  };
  signal?.addEventListener('abort', abort, { once: true });
  return new Promise((resolve, reject) => {
    runner.on('message', (message) => {
      if (message.type === 'session') {
        void onSession(message.sessionId)
          .then(() => {
            if (runner.connected) runner.send({ type: 'session_saved' });
          })
          .catch(() => abort());
      } else if (message.type === 'outcome') outcome = message;
    });
    runner.once('error', () =>
      reject(new Error('Native execution supervisor could not start')),
    );
    runner.once('exit', () => {
      signal?.removeEventListener('abort', abort);
      if (outcome?.ok) resolve(outcome.result);
      else {
        const error = new Error('Supervised native execution did not complete');
        if (outcome) Object.assign(error, outcome.error);
        reject(error);
      }
    });
    runner.send({ type: 'execute', input });
    if (signal?.aborted) abort();
  });
}

async function runChild() {
  const abort = new AbortController();
  let input,
    sessionResolve,
    sessionReject,
    timer,
    started = false,
    finished = false;
  const disconnected = () => {
    if (finished) return;
    if (input) {
      try {
        writeFileSync(
          join(input.directory, `orphan-${input.job.id}.json`),
          JSON.stringify({
            jobId: input.job.id,
            reason: 'scheduler_disconnected',
          }),
          { mode: 0o600 },
        );
      } catch {
        /* Abort still takes priority if the local disk is unavailable. */
      }
    }
    abort.abort();
    sessionReject?.(new Error('Scheduler disconnected'));
  };
  process.on('disconnect', disconnected);
  process.on('error', disconnected);
  const send = (message) => {
    if (!process.connected) {
      disconnected();
      return;
    }
    process.send(message, (error) => {
      if (error) disconnected();
    });
  };
  process.on('message', (message) => {
    if (message.type === 'abort') {
      abort.abort();
      sessionReject?.(new Error('Scheduler stopped'));
    }
    if (message.type === 'session_saved') sessionResolve?.();
    if (message.type !== 'execute' || started) return;
    started = true;
    input = message.input;
    timer = setTimeout(
      () => {
        abort.abort();
        sessionReject?.(new Error('Execution deadline'));
      },
      Math.max(1, input.job.deadline - Date.now()),
    );
    void executeNativeTurn({
      ...input,
      signal: abort.signal,
      onSession: (sessionId) =>
        new Promise((resolve, reject) => {
          sessionResolve = resolve;
          sessionReject = reject;
          if (abort.signal.aborted || !process.connected) {
            reject(new Error('Scheduler unavailable'));
            return;
          }
          send({ type: 'session', sessionId });
        }),
    })
      .then(
        (result) => {
          if (process.connected) send({ type: 'outcome', ok: true, result });
        },
        (error) => {
          if (process.connected)
            send({
              type: 'outcome',
              ok: false,
              error: {
                ownedProcessesExited: error.ownedProcessesExited === true,
                stage: error.stage,
                nativeMetadata: error.nativeMetadata,
              },
            });
        },
      )
      .finally(() => {
        finished = true;
        clearTimeout(timer);
        if (process.connected) process.disconnect();
      });
  });
}
if (process.argv[1] && resolve(process.argv[1]) === entry) await runChild();
