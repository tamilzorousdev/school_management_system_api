import type { TemplateDefinition } from './notification-templates.catalog';

export const HOSTEL_TEMPLATES = {
  HOSTEL_ADMITTED: 'HOSTEL_ADMITTED',
  HOSTEL_BED_CHANGED: 'HOSTEL_BED_CHANGED',
  HOSTEL_CHECKED_OUT: 'HOSTEL_CHECKED_OUT',
  HOSTEL_ABSENT: 'HOSTEL_ABSENT',
  HOSTEL_LEAVE_CONSENT_NEEDED: 'HOSTEL_LEAVE_CONSENT_NEEDED',
  HOSTEL_LEAVE_DECIDED: 'HOSTEL_LEAVE_DECIDED',
  HOSTEL_STUDENT_LEFT: 'HOSTEL_STUDENT_LEFT',
  HOSTEL_STUDENT_RETURNED: 'HOSTEL_STUDENT_RETURNED',
  HOSTEL_LATE_RETURN: 'HOSTEL_LATE_RETURN',
  HOSTEL_VISITOR_ARRIVED: 'HOSTEL_VISITOR_ARRIVED',
  HOSTEL_LEAVE_REQUESTED: 'HOSTEL_LEAVE_REQUESTED',
  HOSTEL_OVERDUE_RETURN: 'HOSTEL_OVERDUE_RETURN',
} as const;

export const HOSTEL_PARENT_TEMPLATES: string[] = [
  HOSTEL_TEMPLATES.HOSTEL_ADMITTED,
  HOSTEL_TEMPLATES.HOSTEL_BED_CHANGED,
  HOSTEL_TEMPLATES.HOSTEL_CHECKED_OUT,
  HOSTEL_TEMPLATES.HOSTEL_ABSENT,
  HOSTEL_TEMPLATES.HOSTEL_LEAVE_CONSENT_NEEDED,
  HOSTEL_TEMPLATES.HOSTEL_LEAVE_DECIDED,
  HOSTEL_TEMPLATES.HOSTEL_STUDENT_LEFT,
  HOSTEL_TEMPLATES.HOSTEL_STUDENT_RETURNED,
  HOSTEL_TEMPLATES.HOSTEL_LATE_RETURN,
  HOSTEL_TEMPLATES.HOSTEL_VISITOR_ARRIVED,
];

export const HOSTEL_STAFF_TEMPLATES: string[] = [
  HOSTEL_TEMPLATES.HOSTEL_LEAVE_REQUESTED,
  HOSTEL_TEMPLATES.HOSTEL_OVERDUE_RETURN,
];

export const HOSTEL_TEMPLATE_CATALOG: TemplateDefinition[] = [
  {
    code: HOSTEL_TEMPLATES.HOSTEL_ADMITTED,
    category: 'hostel',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{student}} joined {{hostel}}',
        body: 'Hostel admission {{admission_no}} for {{student}} is done. Bed: {{bed}}.',
        sms_body: null,
      },
      ta: {
        title: '{{student}} {{hostel}} விடுதியில் சேர்ந்தார்',
        body: '{{student}} அவர்களின் விடுதி சேர்க்கை {{admission_no}} முடிந்தது. படுக்கை: {{bed}}.',
        sms_body: null,
      },
    },
  },
  {
    code: HOSTEL_TEMPLATES.HOSTEL_BED_CHANGED,
    category: 'hostel',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{student}} has a new hostel room',
        body: '{{student}} moved to room {{bed}} in {{hostel}}.',
        sms_body: null,
      },
      ta: {
        title: '{{student}} அவர்களுக்கு புதிய விடுதி அறை',
        body: '{{student}} {{hostel}} விடுதியில் {{bed}} அறைக்கு மாற்றப்பட்டார்.',
        sms_body: null,
      },
    },
  },
  {
    code: HOSTEL_TEMPLATES.HOSTEL_CHECKED_OUT,
    category: 'hostel',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{student}} checked out of the hostel',
        body: '{{student}} checked out of {{hostel}} on {{date}}.',
        sms_body: null,
      },
      ta: {
        title: '{{student}} விடுதியிலிருந்து வெளியேறினார்',
        body: '{{student}} {{date}} அன்று {{hostel}} விடுதியிலிருந்து வெளியேறினார்.',
        sms_body: null,
      },
    },
  },
  {
    code: HOSTEL_TEMPLATES.HOSTEL_ABSENT,
    category: 'hostel',
    push: true,
    sms: 'fallback',
    critical: true,
    text: {
      en: {
        title: '{{student}} missed the hostel roll call',
        body: '{{student}} was not present at the {{slot}} roll call in {{hostel}} on {{date}}. The warden is checking. Call {{warden_phone}} if you know where your child is.',
        sms_body:
          'Dear parent, {{student}} was not present at the {{slot}} hostel roll call on {{date}}. Please call the warden {{warden_phone}}. -TAMILZOROUS',
      },
      ta: {
        title: '{{student}} விடுதி வருகைப் பதிவில் இல்லை',
        body: '{{date}} அன்று {{hostel}} விடுதியின் {{slot}} வருகைப் பதிவில் {{student}} இல்லை. காப்பாளர் சரிபார்க்கிறார். உங்கள் குழந்தை எங்கு இருக்கிறார் என்று தெரிந்தால் {{warden_phone}} எண்ணை அழைக்கவும்.',
        sms_body:
          'அன்புள்ள பெற்றோரே, {{date}} அன்று {{slot}} விடுதி வருகைப் பதிவில் {{student}} இல்லை. காப்பாளரை {{warden_phone}} எண்ணில் அழைக்கவும். -TAMILZOROUS',
      },
    },
  },
  {
    code: HOSTEL_TEMPLATES.HOSTEL_LEAVE_CONSENT_NEEDED,
    category: 'hostel',
    push: true,
    sms: 'fallback',
    critical: false,
    text: {
      en: {
        title: 'Hostel leave for {{student}} needs your OK',
        body: '{{kind}} leave {{from_date}} to {{to_date}}: {{reason}}. Open the app to agree or refuse.',
        sms_body:
          'Dear parent, hostel leave for {{student}} from {{from_date}} to {{to_date}} needs your OK. Open the school app to agree. -TAMILZOROUS',
      },
      ta: {
        title: '{{student}} விடுதி விடுப்புக்கு உங்கள் ஒப்புதல் தேவை',
        body: '{{from_date}} முதல் {{to_date}} வரை {{kind}} விடுப்பு: {{reason}}. ஒப்புக்கொள்ள அல்லது மறுக்க செயலியைத் திறக்கவும்.',
        sms_body:
          'அன்புள்ள பெற்றோரே, {{student}} அவர்களின் {{from_date}} முதல் {{to_date}} வரையிலான விடுதி விடுப்புக்கு உங்கள் ஒப்புதல் தேவை. பள்ளி செயலியைத் திறக்கவும். -TAMILZOROUS',
      },
    },
  },
  {
    code: HOSTEL_TEMPLATES.HOSTEL_LEAVE_DECIDED,
    category: 'hostel',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Hostel leave {{decision}}',
        body: '{{student}}: {{kind}} leave from {{from_date}} to {{to_date}} was {{decision}}. {{note}}',
        sms_body: null,
      },
      ta: {
        title: 'விடுதி விடுப்பு: {{decision}}',
        body: '{{student}}: {{from_date}} முதல் {{to_date}} வரையிலான {{kind}} விடுப்பு {{decision}}. {{note}}',
        sms_body: null,
      },
    },
  },
  {
    code: HOSTEL_TEMPLATES.HOSTEL_STUDENT_LEFT,
    category: 'hostel',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{student}} left the hostel',
        body: '{{student}} left {{hostel}} at {{time}} with {{escort}}. Expected back by {{expected}}.',
        sms_body: null,
      },
      ta: {
        title: '{{student}} விடுதியிலிருந்து புறப்பட்டார்',
        body: '{{student}} {{time}} மணிக்கு {{escort}} உடன் {{hostel}} விடுதியிலிருந்து புறப்பட்டார். {{expected}} க்குள் திரும்ப வேண்டும்.',
        sms_body: null,
      },
    },
  },
  {
    code: HOSTEL_TEMPLATES.HOSTEL_STUDENT_RETURNED,
    category: 'hostel',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{student}} is back in the hostel',
        body: '{{student}} returned to {{hostel}} at {{time}}.',
        sms_body: null,
      },
      ta: {
        title: '{{student}} விடுதிக்குத் திரும்பினார்',
        body: '{{student}} {{time}} மணிக்கு {{hostel}} விடுதிக்குத் திரும்பினார்.',
        sms_body: null,
      },
    },
  },
  {
    code: HOSTEL_TEMPLATES.HOSTEL_LATE_RETURN,
    category: 'hostel',
    push: true,
    sms: 'fallback',
    critical: true,
    text: {
      en: {
        title: '{{student}} has not returned to the hostel',
        body: '{{student}} was due back at {{hostel}} by {{expected}} and is not back yet. Please call the warden {{warden_phone}}.',
        sms_body:
          'Dear parent, {{student}} was due back at the hostel by {{expected}} and is not back yet. Please call the warden {{warden_phone}}. -TAMILZOROUS',
      },
      ta: {
        title: '{{student}} இன்னும் விடுதிக்குத் திரும்பவில்லை',
        body: '{{student}} {{expected}} க்குள் {{hostel}} விடுதிக்குத் திரும்ப வேண்டும்; இன்னும் வரவில்லை. காப்பாளரை {{warden_phone}} எண்ணில் அழைக்கவும்.',
        sms_body:
          'அன்புள்ள பெற்றோரே, {{student}} {{expected}} க்குள் விடுதிக்குத் திரும்ப வேண்டும்; இன்னும் வரவில்லை. காப்பாளரை {{warden_phone}} எண்ணில் அழைக்கவும். -TAMILZOROUS',
      },
    },
  },
  {
    code: HOSTEL_TEMPLATES.HOSTEL_VISITOR_ARRIVED,
    category: 'hostel',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Visitor for {{student}}',
        body: '{{visitor}} ({{relation}}) came to see {{student}} at {{hostel}} at {{time}}.',
        sms_body: null,
      },
      ta: {
        title: '{{student}} அவர்களைப் பார்க்க வருகையாளர்',
        body: '{{visitor}} ({{relation}}) {{time}} மணிக்கு {{hostel}} விடுதியில் {{student}} அவர்களைப் பார்க்க வந்தார்.',
        sms_body: null,
      },
    },
  },
  {
    code: HOSTEL_TEMPLATES.HOSTEL_LEAVE_REQUESTED,
    category: 'hostel',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Hostel leave request: {{student}}',
        body: '{{kind}} leave {{from_date}} to {{to_date}} ({{room}}): {{reason}}',
        sms_body: null,
      },
      ta: {
        title: 'விடுதி விடுப்புக் கோரிக்கை: {{student}}',
        body: '{{from_date}} முதல் {{to_date}} வரை {{kind}} விடுப்பு ({{room}}): {{reason}}',
        sms_body: null,
      },
    },
  },
  {
    code: HOSTEL_TEMPLATES.HOSTEL_OVERDUE_RETURN,
    category: 'hostel',
    push: true,
    sms: 'never',
    critical: true,
    text: {
      en: {
        title: '{{student}} is overdue',
        body: '{{student}} ({{room}}) was due back by {{expected}} from {{kind}} leave {{leave_no}} and has not returned.',
        sms_body: null,
      },
      ta: {
        title: '{{student}} இன்னும் திரும்பவில்லை',
        body: '{{student}} ({{room}}) {{kind}} விடுப்பு {{leave_no}} முடிந்து {{expected}} க்குள் திரும்ப வேண்டும்; இன்னும் வரவில்லை.',
        sms_body: null,
      },
    },
  },
];
