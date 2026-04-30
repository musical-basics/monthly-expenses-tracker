#!/usr/bin/env tsx
/**
 * CLI: apply Commander's known seed list (Higgsfield, Ollama, zBackup,
 * Teachable, BetterHelp, Verizon). Safe to re-run.
 *   npm run seed
 */
import { applySeed } from "../lib/seed";

const r = applySeed();
console.log(`Seed applied: ${r.inserted} new, ${r.updated} updated`);
