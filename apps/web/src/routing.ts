import { routingMetadata, type Definition } from '../../api/src/domain';

// Shared contract only for editor classification. Filling navigation stays on the server.
export const previewRouting = (definition: Definition) => routingMetadata(definition);
export type Routing = ReturnType<typeof previewRouting>;
export interface UpgradePreview {
  revision: number;
  before: Routing;
  after: Routing;
  canUpgrade: boolean;
  errors: Array<{ code: string; message: string }>;
  newlyExclusiveQuestionIds: string[];
  warning: string;
}
export const modeLabel = (mode?: string) =>
  mode === 'exclusive-branches-v1' ? '专属分支模式' : '旧版顺序模式';
