export const ID_CARD_DESIGNS = ['design1', 'design2', 'design3', 'custom'] as const;

export type IdCardDesign = (typeof ID_CARD_DESIGNS)[number];
