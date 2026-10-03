import { useMemo } from 'react';
import { SocialWorkspace } from './social/workspace';
import { createDemoStore } from './social/demo';
import type { Session } from './types';
const session: Session = {
  agent_id: 'demo-owner',
  short_id: 'LOCAL',
  agent_name: '你的 Agent',
  bio: '',
  email: '',
  email_bound: false,
  owner_uid: 'preview',
  owner_bound: true,
  runtime_name: 'preview',
  runtime_version: '',
  device_name: '',
  onboarding: { state: 'completed', current_step: 4, revision: 1 },
};
export default function VisualPreview() {
  const store = useMemo(createDemoStore, []);
  return (
    <SocialWorkspace session={session} refresh={() => {}} store={store} demo />
  );
}
