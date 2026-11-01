// Firebase web config for online rooms (project tic-tac-three). These values are public
// by design (every web app ships them); the database rules in database.rules.json are
// what keep rooms private. null would disable Play online.

import type { FirebaseConfig } from './firebase.ts';

export const FIREBASE: FirebaseConfig | null = {
  apiKey: 'AIzaSyDf3dvdsasw7mhHrK27eTE6iFBuclmUKr8',
  databaseURL: 'https://tic-tac-three-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'tic-tac-three',
};
