import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationReadQueue} from '../src/features/moderation/notification-read-queue.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => {resolve = done; reject = fail;});
  return {promise, resolve, reject};
}

test('idle cleanup runs only after a nonempty queue drains and never for stale work', async () => {
  let idle=0;
  const queue=createNotificationReadQueue({onIdle:()=>idle++});
  await queue.flush();assert.equal(idle,0);assert.equal(queue.hasWork(),false);
  const pending=deferred();const run=queue.add('first',()=>pending.promise);
  assert.equal(queue.hasWork(),true);
  await queue.add('second',()=>{});pending.resolve();await run;
  assert.equal(idle,1);assert.equal(queue.hasWork(),false);
  await queue.flush();assert.equal(idle,1);
  const stale=deferred();const old=queue.add('old',()=>stale.promise);queue.reset();
  stale.resolve();await old;assert.equal(idle,1);assert.equal(queue.hasWork(),false);
});

test('rapid distinct message opens save sequentially without losing queued reads', async () => {
  const queue = createNotificationReadQueue();
  const first = deferred(), second = deferred(), secondStarted = deferred();
  const calls = [];
  let active = 0, maximumActive = 0;
  const operation = (id, gate, started) => async () => {
    active++;
    maximumActive = Math.max(maximumActive, active);
    calls.push(`start:${id}`);
    started?.resolve();
    await gate;
    calls.push(`end:${id}`);
    active--;
  };
  const draining = queue.add('auction:1', operation('first', first.promise));
  await queue.add('moderation:1', operation('second', second.promise, secondStarted));
  await queue.add('auction:2', operation('third'));
  assert.deepEqual(calls, ['start:first']);

  first.resolve();
  await secondStarted.promise;
  assert.deepEqual(calls, ['start:first', 'end:first', 'start:second']);
  second.resolve();
  await draining;
  assert.deepEqual(calls, ['start:first', 'end:first', 'start:second', 'end:second', 'start:third', 'end:third']);
  assert.equal(maximumActive, 1);
});

test('duplicate queued and in-flight message opens retain one original operation', async () => {
  let allowed = false;
  const queue = createNotificationReadQueue({canRun: () => allowed});
  const pending = deferred(), calls = [];
  await queue.add('first', async () => {calls.push('first'); await pending.promise;});
  await queue.add('first', () => calls.push('queued duplicate first'));
  await queue.add('second', () => calls.push('second'));
  await queue.add('second', () => calls.push('queued duplicate second'));
  allowed = true;
  const draining = queue.flush();
  await queue.add('first', () => calls.push('in-flight duplicate first'));
  await queue.add('second', () => calls.push('pending duplicate second'));
  assert.deepEqual(calls, ['first']);

  pending.resolve();
  await draining;
  assert.deepEqual(calls, ['first', 'second']);
  await queue.add('first', () => calls.push('later first'));
  assert.deepEqual(calls, ['first', 'second', 'later first']);
});

test('unavailable authorization retains queued work until an explicit permitted flush', async () => {
  let allowed = false;
  const queue = createNotificationReadQueue({canRun: () => allowed});
  const calls = [];
  await queue.add('first', () => calls.push('first'));
  await queue.add('second', () => calls.push('second'));
  await queue.flush();
  assert.deepEqual(calls, []);
  allowed = true;
  await queue.flush();
  assert.deepEqual(calls, ['first', 'second']);
  await queue.flush();
  assert.deepEqual(calls, ['first', 'second']);
});

test('pausing during an in-flight save stops following reads until resumed', async () => {
  let allowed = true;
  const queue = createNotificationReadQueue({canRun: () => allowed});
  const pending = deferred(), calls = [];
  const draining = queue.add('first', async () => {calls.push('first'); await pending.promise;});
  await queue.add('second', () => calls.push('second'));
  allowed = false;
  await queue.add('third', () => calls.push('third'));
  pending.resolve();
  await draining;
  await queue.flush();
  assert.deepEqual(calls, ['first']);

  allowed = true;
  await queue.flush();
  assert.deepEqual(calls, ['first', 'second', 'third']);
});

test('reset discards old queued reads while late completion cannot disturb new work', async () => {
  const queue = createNotificationReadQueue();
  const oldPending = deferred(), newPending = deferred(), calls = [];
  const oldRun = queue.add('shared', async () => {calls.push('old in-flight'); await oldPending.promise;});
  await queue.add('discarded', () => calls.push('old queued'));
  queue.reset();

  const newRun = queue.add('shared', async () => {calls.push('new in-flight'); await newPending.promise;});
  await queue.add('next', () => calls.push('new queued'));
  assert.deepEqual(calls, ['old in-flight', 'new in-flight']);
  oldPending.resolve();
  await oldRun;
  await queue.add('shared', () => calls.push('duplicate new in-flight'));
  await queue.add('last', () => calls.push('new last'));
  assert.deepEqual(calls, ['old in-flight', 'new in-flight']);

  newPending.resolve();
  await newRun;
  assert.deepEqual(calls, ['old in-flight', 'new in-flight', 'new queued', 'new last']);
});

test('reset while paused removes queued reads before later authorization', async () => {
  let allowed = false;
  const queue = createNotificationReadQueue({canRun: () => allowed});
  const calls = [];
  await queue.add('old', () => calls.push('old'));
  queue.reset();
  allowed = true;
  await queue.flush();
  assert.deepEqual(calls, []);
  await queue.add('new', () => calls.push('new'));
  assert.deepEqual(calls, ['new']);
});

test('rejected and throwing operations do not wedge following or later message reads', async () => {
  const queue = createNotificationReadQueue();
  const pending = deferred(), calls = [];
  const draining = queue.add('reject', async () => {calls.push('reject'); await pending.promise;});
  await queue.add('throw', () => {calls.push('throw'); throw new Error('Save failed');});
  await queue.add('following', () => calls.push('following'));
  pending.reject(new Error('Request failed'));
  await assert.doesNotReject(draining);
  assert.deepEqual(calls, ['reject', 'throw', 'following']);
  await queue.add('reject', () => calls.push('retry'));
  await queue.add('later', () => calls.push('later'));
  assert.deepEqual(calls, ['reject', 'throw', 'following', 'retry', 'later']);
});
