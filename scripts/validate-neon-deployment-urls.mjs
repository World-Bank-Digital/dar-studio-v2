#!/usr/bin/env node

import { readFileSync } from "node:fs";

import {
  sameNeonDatabaseIdentity,
  validNeonOhioConnection,
} from "./deployment-url-policy.mjs";

const mode = process.argv[2];
const input = readFileSync(0, "utf8");
let valid = false;

if (mode === "pooled") {
  valid = validNeonOhioConnection(input, true);
} else if (mode === "direct") {
  valid = validNeonOhioConnection(input, false);
} else if (mode === "pair") {
  const separator = input.indexOf("\0");
  valid =
    separator >= 0 &&
    sameNeonDatabaseIdentity(input.slice(0, separator), input.slice(separator + 1));
} else {
  process.exitCode = 2;
}

if (process.exitCode !== 2) process.exitCode = valid ? 0 : 1;
