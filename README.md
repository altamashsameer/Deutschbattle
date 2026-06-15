# ⚔️ DeutschBattle

A competitive German language learning game. Battle opponents in real-time quiz matches, deal damage with fast correct answers, and climb through CEFR levels from A1.1 to B1.2.

---

## How to Play

1. Enter your username and select your German level
2. Click **Find Match** to be matched with an opponent
3. Answer German questions as fast as you can — first correct answer deals HP damage
4. Wrong answer costs you 5 HP
5. Last player standing wins

---

## Game Modes

- **Find Match** — matched with a real player at your level, or a bot if none available
- **Create Room** — generate a 4-digit PIN and share with a friend
- **Join Room** — enter a friend's PIN to join their match

---

## Levels

`A1.1` · `A1.2` · `A2.1` · `A2.2` · `B1.1` · `B1.2`

Questions sourced from the Netzwerk neu curriculum (Klett Verlag), covering vocabulary, grammar, verb conjugation, sentence order, prepositions, and more.

---

## Tech Stack

| Layer | Tool |
|---|---|
| Frontend | HTML · CSS · JavaScript |
| Multiplayer | PeerJS (WebRTC) |
| Hosting | GitHub Pages |

No backend. No accounts. No cost.

---

## Files

```
index.html       — game UI and logic
network.js       — multiplayer (PeerJS)
questions.json   — question bank (260 questions)
```

---

Built with ❤️ for German language learners.
