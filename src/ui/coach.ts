// The guided practice game for first-time players: you against the computer, on the
// plain Twist board, with a coach line for every turn. You make each move yourself (the
// glowing blocks show which); the computer's replies are scripted so the game teaches
// painting, blocking, the 3-mark limit and twisting, and ends in your win.
// Pure data (no DOM): test/coach.test.ts plays it through the real rules.

import type { Move } from '../core/match.ts';
import type { Twist } from '../core/twist.ts';

export interface CoachTurn {
  /** What to do now: shown and read aloud. */
  say: string;
  /** The move the player is guided to make. */
  you: Move;
  /** Blocks to light up while the player decides. */
  focus: number[];
  /** The computer's reply, and what the coach says while it plays. */
  pc?: Move;
  pcSay?: string;
}

const place = (cell: number): Move => ({ kind: 'place', cell });
const twist = (axis: 0 | 1 | 2, slice: 0 | 1 | 2, dir: 1 | -1): Move => ({ kind: 'twist', twist: { axis, slice, dir } as Twist });

// Visible from the default view: the top (18–26), the front (6–8, 15–17, 24–26) and the
// left side (0, 3, 6, 9, 12, 15, 18, 21, 24).
export const PRACTICE: CoachTurn[] = [
  {
    say: 'Your turn! You play {you}. Tap the glowing block to paint it.',
    you: place(8),
    focus: [8],
    pc: place(21),
    pcSay: 'Now the computer paints a block.',
  },
  {
    say: 'Paint the glowing block in the middle row.',
    you: place(15),
    focus: [15],
    pc: place(22),
    pcSay: 'The computer paints next to its first block…',
  },
  {
    say: 'Careful: the computer has two in a row on top. Block it! Paint the third block of its row.',
    you: place(23),
    focus: [23, 21, 22],
    pc: place(0),
    pcSay: 'Blocked! The computer plays somewhere else.',
  },
  {
    say: 'You have 3 marks, the most you can keep. See the numbers? Paint one more and your number 1 fades. Paint the glowing block.',
    you: place(16),
    focus: [16, 8],
    pc: place(17),
    pcSay: 'Your 1 faded, and you made two in a row. But the computer blocks your row…',
  },
  {
    say: 'Painting would fade a mark, so twist! Swipe down on the glowing column at the right, then tap ✓ Twist. Your top mark rolls into the row.',
    // Swiping down on the front face's right column (or up on the top's right column)
    // turns the right layer this way: the top mark at 23 rolls down to 17.
    you: twist(0, 2, -1),
    focus: [26, 17, 8, 23],
  },
];
