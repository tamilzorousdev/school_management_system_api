import type { TemplateDefinition } from './notification-templates.catalog';

export const INVENTORY_TEMPLATES = {
  INVENTORY_ASSET_ASSIGNED: 'INVENTORY_ASSET_ASSIGNED',
  INVENTORY_RETURN_DUE: 'INVENTORY_RETURN_DUE',
  INVENTORY_APPROVAL_NEEDED: 'INVENTORY_APPROVAL_NEEDED',
  INVENTORY_REQUEST_UPDATE: 'INVENTORY_REQUEST_UPDATE',
  INVENTORY_MAINTENANCE_DUE: 'INVENTORY_MAINTENANCE_DUE',
  INVENTORY_WARRANTY_EXPIRING: 'INVENTORY_WARRANTY_EXPIRING',
  INVENTORY_LOW_STOCK: 'INVENTORY_LOW_STOCK',
  INVENTORY_TICKET_RESOLVED: 'INVENTORY_TICKET_RESOLVED',
} as const;

const base = { category: 'inventory' as const, push: true, sms: 'never' as const, critical: false };

export const INVENTORY_TEMPLATE_CATALOG: TemplateDefinition[] = [
  {
    ...base,
    code: INVENTORY_TEMPLATES.INVENTORY_ASSET_ASSIGNED,
    text: {
      en: {
        title: 'School asset given to you',
        body: '{{assets}} {{verb}} now with you. Please confirm you received {{them}} in the app.',
        sms_body: null,
      },
      ta: {
        title: 'பள்ளிச் சொத்து உங்களிடம் ஒப்படைக்கப்பட்டது',
        body: '{{assets}} இப்போது உங்களிடம் உள்ளது. பெற்றுக்கொண்டதைச் செயலியில் உறுதிசெய்யவும்.',
        sms_body: null,
      },
    },
  },
  {
    ...base,
    code: INVENTORY_TEMPLATES.INVENTORY_RETURN_DUE,
    text: {
      en: {
        title: 'Please return a school asset',
        body: '{{asset}} ({{tag}}) was due back on {{due_date}}. Please return it to the store.',
        sms_body: null,
      },
      ta: {
        title: 'பள்ளிச் சொத்தைத் திருப்பித் தரவும்',
        body: '{{asset}} ({{tag}}) {{due_date}} அன்று திருப்பித் தரப்பட வேண்டியது. களஞ்சியத்தில் ஒப்படைக்கவும்.',
        sms_body: null,
      },
    },
  },
  {
    ...base,
    code: INVENTORY_TEMPLATES.INVENTORY_APPROVAL_NEEDED,
    text: {
      en: {
        title: '{{kind}} waiting for approval',
        body: '{{number}}: {{summary}}. Requested by {{by}}.',
        sms_body: null,
      },
      ta: {
        title: '{{kind}} ஒப்புதலுக்குக் காத்திருக்கிறது',
        body: '{{number}}: {{summary}}. கோரியவர் {{by}}.',
        sms_body: null,
      },
    },
  },
  {
    ...base,
    code: INVENTORY_TEMPLATES.INVENTORY_REQUEST_UPDATE,
    text: {
      en: {
        title: '{{kind}} {{status}}',
        body: '{{number}} ({{summary}}) was {{status}}.{{note}}',
        sms_body: null,
      },
      ta: {
        title: '{{kind}}: {{status}}',
        body: '{{number}} ({{summary}}) — {{status}}.{{note}}',
        sms_body: null,
      },
    },
  },
  {
    ...base,
    code: INVENTORY_TEMPLATES.INVENTORY_MAINTENANCE_DUE,
    text: {
      en: {
        title: 'Maintenance due for {{count}} assets',
        body: 'Due by {{date}}: {{list}}.',
        sms_body: null,
      },
      ta: {
        title: '{{count}} சொத்துகளுக்குப் பராமரிப்பு தேவை',
        body: '{{date}} க்குள்: {{list}}.',
        sms_body: null,
      },
    },
  },
  {
    ...base,
    code: INVENTORY_TEMPLATES.INVENTORY_WARRANTY_EXPIRING,
    text: {
      en: {
        title: 'Warranty or AMC ending for {{count}} assets',
        body: 'Ending within {{days}} days: {{list}}.',
        sms_body: null,
      },
      ta: {
        title: '{{count}} சொத்துகளின் உத்தரவாதம் / AMC முடிகிறது',
        body: '{{days}} நாட்களுக்குள் முடிவடைகிறது: {{list}}.',
        sms_body: null,
      },
    },
  },
  {
    ...base,
    code: INVENTORY_TEMPLATES.INVENTORY_LOW_STOCK,
    text: {
      en: {
        title: '{{count}} stock items are low',
        body: 'At or below the reorder level: {{list}}.',
        sms_body: null,
      },
      ta: {
        title: '{{count}} பொருட்களின் இருப்பு குறைவு',
        body: 'மறு ஆர்டர் அளவுக்குக் கீழ்: {{list}}.',
        sms_body: null,
      },
    },
  },
  {
    ...base,
    code: INVENTORY_TEMPLATES.INVENTORY_TICKET_RESOLVED,
    text: {
      en: {
        title: '{{asset}} is fixed',
        body: '{{ticket_no}} for {{asset}} ({{tag}}) is resolved: {{resolution}}.',
        sms_body: null,
      },
      ta: {
        title: '{{asset}} சரிசெய்யப்பட்டது',
        body: '{{asset}} ({{tag}}) க்கான {{ticket_no}} முடிந்தது: {{resolution}}.',
        sms_body: null,
      },
    },
  },
];
