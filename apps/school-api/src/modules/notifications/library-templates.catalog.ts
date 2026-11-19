import type { TemplateDefinition } from './notification-templates.catalog';

export const LIBRARY_TEMPLATES = {
  LIBRARY_BOOK_ISSUED: 'LIBRARY_BOOK_ISSUED',
  LIBRARY_DUE_SOON: 'LIBRARY_DUE_SOON',
  LIBRARY_DUE_TODAY: 'LIBRARY_DUE_TODAY',
  LIBRARY_OVERDUE: 'LIBRARY_OVERDUE',
  LIBRARY_OVERDUE_ESCALATED: 'LIBRARY_OVERDUE_ESCALATED',
  LIBRARY_OVERDUE_LONG: 'LIBRARY_OVERDUE_LONG',
  LIBRARY_BOOK_RETURNED: 'LIBRARY_BOOK_RETURNED',
  LIBRARY_FINE_RAISED: 'LIBRARY_FINE_RAISED',
  LIBRARY_FINE_PAID: 'LIBRARY_FINE_PAID',
} as const;

export const LIBRARY_TEMPLATE_CATALOG: TemplateDefinition[] = [
  {
    code: LIBRARY_TEMPLATES.LIBRARY_BOOK_ISSUED,
    category: 'library',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Library book issued to {{member}}',
        body: '{{member}} borrowed {{books}} from the school library. Please return by {{due_date}}.',
        sms_body: null,
      },
      ta: {
        title: '{{member}} நூலகப் புத்தகம் பெற்றார்',
        body: '{{member}} பள்ளி நூலகத்திலிருந்து {{books}} பெற்றுள்ளார். {{due_date}} க்குள் திருப்பித் தரவும்.',
        sms_body: null,
      },
    },
  },
  {
    code: LIBRARY_TEMPLATES.LIBRARY_DUE_SOON,
    category: 'library',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Library book due on {{due_date}}',
        body: '"{{book}}" borrowed by {{member}} is due back on {{due_date}}.',
        sms_body: null,
      },
      ta: {
        title: 'நூலகப் புத்தகம் {{due_date}} அன்று திருப்ப வேண்டும்',
        body: '{{member}} பெற்ற "{{book}}" புத்தகத்தை {{due_date}} அன்று திருப்பித் தர வேண்டும்.',
        sms_body: null,
      },
    },
  },
  {
    code: LIBRARY_TEMPLATES.LIBRARY_DUE_TODAY,
    category: 'library',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Library book due today',
        body: 'Please send "{{book}}" back to the library today. {{member}} borrowed it on {{issued_on}}.',
        sms_body: null,
      },
      ta: {
        title: 'நூலகப் புத்தகம் இன்று திருப்ப வேண்டும்',
        body: '"{{book}}" புத்தகத்தை இன்று நூலகத்தில் திருப்பித் தரவும். {{member}} இதை {{issued_on}} அன்று பெற்றார்.',
        sms_body: null,
      },
    },
  },
  {
    code: LIBRARY_TEMPLATES.LIBRARY_OVERDUE,
    category: 'library',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Library book overdue',
        body: '"{{book}}" borrowed by {{member}} was due on {{due_date}} ({{days}} late). Late fine so far: {{fine}}. Please return it soon.',
        sms_body: null,
      },
      ta: {
        title: 'நூலகப் புத்தகம் தாமதம்',
        body: '{{member}} பெற்ற "{{book}}" புத்தகம் {{due_date}} அன்று திருப்பப்பட வேண்டியது ({{days}} தாமதம்). இதுவரை அபராதம்: {{fine}}. விரைவில் திருப்பித் தரவும்.',
        sms_body: null,
      },
    },
  },
  {
    code: LIBRARY_TEMPLATES.LIBRARY_OVERDUE_ESCALATED,
    category: 'library',
    push: true,
    sms: 'fallback',
    critical: false,
    text: {
      en: {
        title: 'Library book still not returned',
        body: '"{{book}}" borrowed by {{member}} ({{class}}) is {{days}} late. Late fine so far: {{fine}}. Please return it to the library.',
        sms_body:
          '{{member}} has not returned the library book "{{book}}" ({{days}} late). Please return it. - {{school}}',
      },
      ta: {
        title: 'நூலகப் புத்தகம் இன்னும் திருப்பப்படவில்லை',
        body: '{{member}} ({{class}}) பெற்ற "{{book}}" புத்தகம் {{days}} தாமதம். இதுவரை அபராதம்: {{fine}}. நூலகத்தில் திருப்பித் தரவும்.',
        sms_body: '{{member}} நூலகப் புத்தகம் "{{book}}" இன்னும் திருப்பவில்லை ({{days}} தாமதம்). - {{school}}',
      },
    },
  },
  {
    code: LIBRARY_TEMPLATES.LIBRARY_OVERDUE_LONG,
    category: 'library',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Library book {{days}} late',
        body: '"{{book}}" ({{accession_no}}) with {{member}} is {{days}} late. Follow up or mark it lost.',
        sms_body: null,
      },
      ta: {
        title: 'நூலகப் புத்தகம் {{days}} தாமதம்',
        body: '{{member}} இடம் உள்ள "{{book}}" ({{accession_no}}) {{days}} தாமதம். தொடர்பு கொள்ளவும் அல்லது தொலைந்ததாகக் குறிக்கவும்.',
        sms_body: null,
      },
    },
  },
  {
    code: LIBRARY_TEMPLATES.LIBRARY_BOOK_RETURNED,
    category: 'library',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Library book returned',
        body: '{{member}} returned "{{book}}" to the library. Thank you.',
        sms_body: null,
      },
      ta: {
        title: 'நூலகப் புத்தகம் திருப்பப்பட்டது',
        body: '{{member}} "{{book}}" புத்தகத்தை நூலகத்தில் திருப்பித் தந்தார். நன்றி.',
        sms_body: null,
      },
    },
  },
  {
    code: LIBRARY_TEMPLATES.LIBRARY_FINE_RAISED,
    category: 'library',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Library fine of {{amount}}',
        body: 'A library fine of {{amount}} was raised for {{member}}: {{reason}}. Please pay at the library.',
        sms_body: null,
      },
      ta: {
        title: 'நூலக அபராதம் {{amount}}',
        body: '{{member}} க்கு {{amount}} நூலக அபராதம் விதிக்கப்பட்டது: {{reason}}. நூலகத்தில் செலுத்தவும்.',
        sms_body: null,
      },
    },
  },
  {
    code: LIBRARY_TEMPLATES.LIBRARY_FINE_PAID,
    category: 'library',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Library fine paid',
        body: 'Received {{amount}} towards the library fine of {{member}}. Receipt {{receipt_no}}.',
        sms_body: null,
      },
      ta: {
        title: 'நூலக அபராதம் செலுத்தப்பட்டது',
        body: '{{member}} நூலக அபராதத்துக்கு {{amount}} பெறப்பட்டது. ரசீது {{receipt_no}}.',
        sms_body: null,
      },
    },
  },
];
