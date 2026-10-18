import type { GenerationType } from '../types';

export interface GenerationModelOption {
  readonly id: string;
  readonly name: string;
  readonly providerId: string;
  readonly generationTypes: readonly GenerationType[];
}

// Public catalog snapshot, not an account activation or API-key permission check.
export const GENERATION_MODEL_CATALOG_SOURCE = 'https://docs.volcengine.com/docs/ark/model-list?lang=zh';
export const GENERATION_MODEL_CATALOG_CHECKED_AT = '2026-10-16';

const imageTypes = ['text-to-image', 'image-to-image'] as const;
const videoTypes = ['text-to-video', 'image-to-video', 'video-to-video'] as const;
const models: readonly GenerationModelOption[] = [
  { id: 'doubao-seedream-5-0-pro-260628', name: 'Seedream 5.0 Pro', providerId: 'volcengine', generationTypes: imageTypes },
  { id: 'doubao-seedream-5-0-flash-260915', name: 'Seedream 5.0 Flash', providerId: 'volcengine', generationTypes: imageTypes },
  { id: 'doubao-seedance-2-0-mini-260615', name: 'Seedance 2.0 Mini', providerId: 'volcengine', generationTypes: videoTypes },
  { id: 'doubao-seedance-2-5-260628', name: 'Seedance 2.5', providerId: 'volcengine', generationTypes: videoTypes },
  { id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0', providerId: 'volcengine', generationTypes: videoTypes },
  { id: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast', providerId: 'volcengine', generationTypes: videoTypes }
];

/** Listed models supporting this generation method; custom IDs remain valid inputs. */
export function listGenerationModels(providerId: string, type: string): readonly GenerationModelOption[] {
  return models.filter(model => model.providerId === providerId && model.generationTypes.some(capability => capability === type));
}
