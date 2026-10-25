# Parrothit
For blog website 


## Admin 1 Interaction Master Controls
The owner-only control page is `admin/parrot-rooms-chat.html`. It controls the overall Interaction page, all rooms, private chat, posting/replies/reactions/friend requests/invites, image/voice media switches, moderation, and member suspension. The separate Mini Mart control remains at `admin/parrot-mini-mart.html`. Run `supabase/community-admin-controls.sql` last after the interaction, social-features, marketplace, and private-chat SQL migrations. See `PARROTHIT-INTERACTION-SETUP.txt` for setup steps and verification limitations.


## Newsroom Phase 1
See `PARROTHIT-NEWSROOM-PHASE1.txt`. The migration is `supabase/newsroom-phase1.sql`; optional scheduled publishing setup is `supabase/newsroom-scheduled-publishing-optional.sql`.
