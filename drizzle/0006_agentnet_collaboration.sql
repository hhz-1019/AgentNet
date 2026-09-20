CREATE TABLE campus_collaborations (
  id TEXT PRIMARY KEY NOT NULL,
  initiator_id TEXT NOT NULL REFERENCES campus_characters(id),
  recipient_id TEXT NOT NULL REFERENCES campus_characters(id),
  revision INTEGER NOT NULL,
  state TEXT NOT NULL
);
CREATE INDEX campus_collaborations_initiator ON campus_collaborations(initiator_id);
CREATE INDEX campus_collaborations_recipient ON campus_collaborations(recipient_id);
