import { RequireAuth } from '@/features/auth/components/require-auth';
import { AssistantChatScreen } from '@/features/ai-assistant/components/assistant-chat-screen';

export default function Page() {
  return (
    <RequireAuth>
      <AssistantChatScreen />
    </RequireAuth>
  );
}
