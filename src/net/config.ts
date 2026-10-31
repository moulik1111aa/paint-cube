// Firebase web config for online rooms. These values are public by design (every web
// app ships them); the database rules in database.rules.json are what keep rooms
// private. null until the project is set up: Play online stays disabled.

import type { FirebaseConfig } from './firebase.ts';

export const FIREBASE: FirebaseConfig | null = null;
