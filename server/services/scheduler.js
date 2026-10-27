'use strict';
/**
 * Interval jobs that never overlap, with exponential backoff on failure.
 *
 * Each job supplies:
 *   interval()  → ms between runs, or 0 when the job is disabled (re-read every tick)
 *   run()       → async; resolve { ok:false } or throw to count as a failure
 */
class Scheduler {
  constructor({ log } = {}) {
    this.log = log || { info() {}, warn() {}, error() {} };
    this.jobs = new Map();
    this.started = false;
  }

  add(name, { interval, run, initialDelayMs = 15000, maxBackoffMs = 2 * 3600 * 1000, idlePollMs = 60000 }) {
    this.jobs.set(name, { name, interval, run, initialDelayMs, maxBackoffMs, idlePollMs, timer: null, running: false, failures: 0, lastRun: null });
    if (this.started) this.arm(this.jobs.get(name), initialDelayMs);
    return this;
  }

  start() {
    this.started = true;
    for (const job of this.jobs.values()) this.arm(job, job.initialDelayMs);
  }

  stop() {
    this.started = false;
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      job.timer = null;
    }
  }

  /** Re-arm a job right away (e.g. after its config changed). */
  reschedule(name, delayMs = 2000) {
    const job = this.jobs.get(name);
    if (job && this.started) this.arm(job, delayMs);
  }

  arm(job, delay) {
    clearTimeout(job.timer);
    job.timer = setTimeout(() => this.tick(job), Math.max(0, delay));
    if (job.timer.unref) job.timer.unref();
  }

  async tick(job) {
    job.timer = null;
    if (!this.started) return;
    let interval = 0;
    try {
      interval = Number(job.interval()) || 0;
    } catch {
      interval = 0;
    }
    if (interval <= 0) {
      // Disabled: check again later in case it gets enabled.
      this.arm(job, job.idlePollMs);
      return;
    }
    if (job.running) {
      this.arm(job, interval);
      return;
    }
    job.running = true;
    let ok = true;
    try {
      const res = await job.run();
      if (res && res.ok === false) ok = false;
    } catch (err) {
      // 409 = a manual run of the same job is in progress: not a failure, just skip this slot.
      ok = !!(err && err.status === 409);
      if (!ok) this.log.warn(`job ${job.name} failed: ${err && err.message}`);
    } finally {
      job.running = false;
      job.lastRun = new Date().toISOString();
    }
    job.failures = ok ? 0 : job.failures + 1;
    const next = ok ? interval : Math.min(interval * 2 ** job.failures, Math.max(interval, job.maxBackoffMs));
    if (!ok && job.failures > 1) this.log.info(`job ${job.name}: ${job.failures} failures in a row, next try in ${Math.round(next / 60000)} min`);
    if (this.started) this.arm(job, next);
  }

  status() {
    return Object.fromEntries([...this.jobs.values()].map((j) => [j.name, { running: j.running, failures: j.failures, lastRun: j.lastRun }]));
  }
}

module.exports = { Scheduler };
