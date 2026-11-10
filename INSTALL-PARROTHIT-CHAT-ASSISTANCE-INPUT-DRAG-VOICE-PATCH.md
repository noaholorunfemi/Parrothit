# PARROTHIT Chat Assistance — Composer, Draggable Launcher and Voice Patch

## What this patch changes
- Replaces the easy-to-miss single-line field with a clearly visible, multiline message box. Enter sends; Shift+Enter adds a new line.
- Forces the composer, textarea and Send button to remain visible even when site-wide CSS contains conflicting input/form rules.
- Makes the small chat launcher draggable with mouse, touch or stylus. Its position is saved in the visitor browser and restored on other public pages. Dragging does not open chat; tapping still opens the dedicated full-page assistant.
- Adds friendly typo-aware handling: AI answers infer obvious mistakes without embarrassing visitors; the fallback navigator fuzzy-matches common PARROTHIT topics.
- Improves speech synthesis voice loading and fallback, and changes the top voice button to a direct voice test. Cloud text-to-speech is no longer unnecessarily tied to the separate AI-answer toggle.
- Versions shared script links so cached browsers request the updated launcher on all pages that already load the assistant script.

## Install
1. Extract this patch into the PARROTHIT website root and overwrite matching files.
2. Redeploy the Supabase function:

```bash
supabase functions deploy parrothit-support-chatbot --no-verify-jwt
```

3. Purge the Cloudflare cache for `/js/parrothit-ai-assistant.js` and the changed HTML pages, or wait for your normal cache expiry.
4. Open the site on a phone and desktop. Drag the round chat icon to another position, refresh, then tap it. Type a message in the large composer and send.
5. On the chat page, tap **Test voice** once. Then send a question and use **Listen** below an assistant reply.

## Voice configuration
- Device/browser speech is used as a fallback and does not require an OpenAI key. The available voice depends on the visitor's device and installed voice packs; the browser chooses an English female-sounding voice where available.
- For the consistent soft cloud voice, set `OPENAI_API_KEY` as a Supabase secret and keep the chatbot globally enabled. `PARROTHIT_CHATBOT_TTS_MODEL` and `PARROTHIT_CHATBOT_TTS_VOICE` are optional overrides; defaults remain in the Edge Function (`gpt-4o-mini-tts` / `shimmer`).
- Cloud TTS is independent of the **Use AI** answer toggle. AI-generated answers still require the key and **Use AI** to be enabled.
- Some mobile browsers block automatic audio until a visitor taps a control. The voice-test button and per-reply Listen controls provide that user gesture.

## Files
- `js/parrothit-ai-assistant.js` — composer, launcher, drag persistence, voice playback.
- `supabase/functions/parrothit-support-chatbot/index.ts` — typo-aware answers and voice endpoint gating.
- `chat-assistance.html` and HTML script-reference updates — cache-bust the updated shared script.

No SQL migration is required. This patch does not change advertiser or member account data.
