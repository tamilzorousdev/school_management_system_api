import { Language } from '../users/entities/user.entity';
import { NotificationCategory } from './entities/notification.entity';
import { SmsMode } from './entities/notification-template.entity';

export const TEMPLATES = {
  SYSTEM_TEST: 'SYSTEM_TEST',
  ACCOUNT_INVITE: 'ACCOUNT_INVITE',
  STUDENT_ABSENT: 'STUDENT_ABSENT',
  LEAVE_STATUS: 'LEAVE_STATUS',
  BUS_STARTED: 'BUS_STARTED',
  BUS_APPROACHING: 'BUS_APPROACHING',
  BUS_ARRIVED: 'BUS_ARRIVED',
  STUDENT_BOARDED: 'STUDENT_BOARDED',
  STUDENT_ALIGHTED: 'STUDENT_ALIGHTED',
  SOS_ALERT: 'SOS_ALERT',
  SAFETY_ALERT: 'SAFETY_ALERT',
  SAFETY_ALERT_HIGH: 'SAFETY_ALERT_HIGH',
  DIARY_POSTED: 'DIARY_POSTED',
  MEETING_REMINDER: 'MEETING_REMINDER',
  MEETING_SCHEDULED: 'MEETING_SCHEDULED',
  MEETING_CANCELLED: 'MEETING_CANCELLED',
  MEETING_ENDING: 'MEETING_ENDING',
  MEETING_NOTES_SHARED: 'MEETING_NOTES_SHARED',
  DIARY_REJECTED: 'DIARY_REJECTED',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
  ANNOUNCEMENT_URGENT: 'ANNOUNCEMENT_URGENT',
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  STAFF_LEAVE_STATUS: 'STAFF_LEAVE_STATUS',
  LEAVE_APPROVAL_NEEDED: 'LEAVE_APPROVAL_NEEDED',
  SUBSTITUTE_ASSIGNED: 'SUBSTITUTE_ASSIGNED',
  PAYSLIP_READY: 'PAYSLIP_READY',
  FEE_DUE: 'FEE_DUE',
  FEE_OVERDUE: 'FEE_OVERDUE',
  FLEET_DOCUMENT_EXPIRY: 'FLEET_DOCUMENT_EXPIRY',
  VEHICLE_FAULT: 'VEHICLE_FAULT',
  TRIP_NOT_BOARDED: 'TRIP_NOT_BOARDED',
  RESULT_PUBLISHED: 'RESULT_PUBLISHED',
  ACHIEVEMENT_ADDED: 'ACHIEVEMENT_ADDED',
  CLASS_COMBINED: 'CLASS_COMBINED',
  STUDENT_LEAVE_REQUEST: 'STUDENT_LEAVE_REQUEST',
  MEETING_ACCEPTED: 'MEETING_ACCEPTED',
  MEETING_DECLINED: 'MEETING_DECLINED',
} as const;

interface TemplateText {
  title: string;
  body: string;
  sms_body: string | null;
}

export interface TemplateDefinition {
  code: string;
  category: NotificationCategory;
  push: boolean;
  sms: SmsMode;
  critical: boolean;
  text: Record<Language, TemplateText>;
}

export const TEMPLATE_CATALOG: TemplateDefinition[] = [
  {
    code: TEMPLATES.SYSTEM_TEST,
    category: 'system',
    push: true,
    sms: 'fallback',
    critical: false,
    text: {
      en: {
        title: 'Test notification',
        body: 'Hello {{name}}, this is a test message from {{school}}. Notifications are working.',
        sms_body: 'Dear {{name}}, this is a test message from {{school}}. -TAMILZOROUS',
      },
      ta: {
        title: 'சோதனை அறிவிப்பு',
        body: 'வணக்கம் {{name}}, இது {{school}} அனுப்பிய சோதனைச் செய்தி. அறிவிப்புகள் சரியாக வேலை செய்கின்றன.',
        sms_body: 'அன்புள்ள {{name}}, இது {{school}} அனுப்பிய சோதனைச் செய்தி. -TAMILZOROUS',
      },
    },
  },
  {
    code: TEMPLATES.ACCOUNT_INVITE,
    category: 'account',
    push: false,
    sms: 'always',
    critical: false,
    text: {
      en: {
        title: 'Welcome to {{school}}',
        body: 'Hi {{name}}, your {{app}} account is ready. Install the app and sign in with this mobile number.',
        sms_body:
          'Dear {{name}}, your {{school}} {{app}} account is ready. Install the app and sign in with this mobile number. -TAMILZOROUS',
      },
      ta: {
        title: '{{school}}-க்கு வரவேற்கிறோம்',
        body: 'வணக்கம் {{name}}, உங்கள் {{app}} கணக்கு தயார். செயலியை நிறுவி இந்த மொபைல் எண்ணுடன் உள்நுழையவும்.',
        sms_body:
          'அன்புள்ள {{name}}, உங்கள் {{school}} {{app}} கணக்கு தயார். செயலியை நிறுவி இந்த மொபைல் எண்ணுடன் உள்நுழையவும். -TAMILZOROUS',
      },
    },
  },
  {
    code: TEMPLATES.STUDENT_ABSENT,
    category: 'attendance',
    push: true,
    sms: 'fallback',
    critical: true,
    text: {
      en: {
        title: '{{student}} is absent today',
        body: '{{student}} ({{class}}) was marked absent on {{date}}. Contact the class teacher if this is not correct.',
        sms_body: 'Dear parent, {{student}} ({{class}}) was marked absent on {{date}}. -TAMILZOROUS',
      },
      ta: {
        title: '{{student}} இன்று வருகை தரவில்லை',
        body: '{{student}} ({{class}}) {{date}} அன்று வருகை இல்லை எனக் குறிக்கப்பட்டுள்ளார். இது தவறு எனில் வகுப்பு ஆசிரியரைத் தொடர்பு கொள்ளவும்.',
        sms_body:
          'அன்புள்ள பெற்றோரே, {{student}} ({{class}}) {{date}} அன்று வருகை இல்லை எனக் குறிக்கப்பட்டுள்ளார். -TAMILZOROUS',
      },
    },
  },
  {
    code: TEMPLATES.LEAVE_STATUS,
    category: 'attendance',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Leave request {{status}}',
        body: 'The leave request for {{student}} from {{from}} to {{to}} was {{status}}.',
        sms_body: null,
      },
      ta: {
        title: 'விடுப்பு கோரிக்கை {{status}}',
        body: '{{student}}-க்கான {{from}} முதல் {{to}} வரையிலான விடுப்பு கோரிக்கை {{status}}.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.STAFF_LEAVE_STATUS,
    category: 'attendance',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Your leave is {{status}}',
        body: 'Your {{type}} from {{from}} to {{to}} ({{days}} days) is {{status}}.{{note}}',
        sms_body: null,
      },
      ta: {
        title: 'உங்கள் விடுப்பு {{status}}',
        body: '{{from}} முதல் {{to}} வரையிலான உங்கள் {{type}} ({{days}} நாட்கள்) {{status}}.{{note}}',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.LEAVE_APPROVAL_NEEDED,
    category: 'approval',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Leave waiting for you',
        body: '{{name}} applied for {{type}} from {{from}} to {{to}} ({{days}} days).',
        sms_body: null,
      },
      ta: {
        title: 'உங்கள் ஒப்புதலுக்கு விடுப்பு',
        body: '{{name}} {{from}} முதல் {{to}} வரை {{type}} ({{days}} நாட்கள்) கோரியுள்ளார்.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.MEETING_ACCEPTED,
    category: 'meeting',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{by}} accepted the meeting',
        body: '{{title}} about {{student}} on {{time}}.{{note}}',
        sms_body: null,
      },
      ta: {
        title: '{{by}} சந்திப்பை ஏற்றுக்கொண்டார்',
        body: '{{student}} பற்றிய {{title}}, {{time}}.{{note}}',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.MEETING_DECLINED,
    category: 'meeting',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{by}} declined the meeting',
        body: '{{title}} about {{student}} on {{time}}.{{note}} You can still join at that time, or cancel and book another time.',
        sms_body: null,
      },
      ta: {
        title: '{{by}} சந்திப்பை மறுத்தார்',
        body: '{{student}} பற்றிய {{title}}, {{time}}.{{note}} அந்த நேரத்தில் இணையலாம் அல்லது ரத்து செய்து வேறு நேரம் பதிவு செய்யலாம்.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.STUDENT_LEAVE_REQUEST,
    category: 'approval',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Leave request for {{student}}',
        body: '{{student}} ({{class}}): leave from {{from}} to {{to}}. {{reason}}',
        sms_body: null,
      },
      ta: {
        title: '{{student}} விடுப்பு கோரிக்கை',
        body: '{{student}} ({{class}}): {{from}} முதல் {{to}} வரை விடுப்பு. {{reason}}',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.BUS_STARTED,
    category: 'transport',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Bus has started',
        body: '{{bus}} has started the {{trip}} trip. Track it live in the app.',
        sms_body: null,
      },
      ta: {
        title: 'பேருந்து புறப்பட்டது',
        body: '{{bus}} {{trip}} பயணத்தைத் தொடங்கியது. செயலியில் நேரலையில் பார்க்கவும்.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.BUS_APPROACHING,
    category: 'transport',
    push: true,
    sms: 'fallback',
    critical: true,
    text: {
      en: {
        title: 'Bus is {{minutes}} min away',
        body: '{{bus}} will reach {{stop}} in about {{minutes}} minutes.',
        sms_body: '{{bus}} will reach {{stop}} in about {{minutes}} minutes. -TAMILZOROUS',
      },
      ta: {
        title: 'பேருந்து {{minutes}} நிமிடத்தில் வரும்',
        body: '{{bus}} சுமார் {{minutes}} நிமிடங்களில் {{stop}} வந்தடையும்.',
        sms_body: '{{bus}} சுமார் {{minutes}} நிமிடங்களில் {{stop}} வந்தடையும். -TAMILZOROUS',
      },
    },
  },
  {
    code: TEMPLATES.BUS_ARRIVED,
    category: 'transport',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: { title: 'Bus reached {{place}}', body: '{{bus}} reached {{place}} at {{time}}.', sms_body: null },
      ta: {
        title: 'பேருந்து {{place}} வந்தடைந்தது',
        body: '{{bus}} {{time}} மணிக்கு {{place}} வந்தடைந்தது.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.STUDENT_BOARDED,
    category: 'transport',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{student}} boarded the bus',
        body: '{{student}} boarded {{bus}} at {{stop}} at {{time}}.',
        sms_body: null,
      },
      ta: {
        title: '{{student}} பேருந்தில் ஏறினார்',
        body: '{{student}} {{time}} மணிக்கு {{stop}}-இல் {{bus}}-இல் ஏறினார்.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.STUDENT_ALIGHTED,
    category: 'transport',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{student}} got off the bus',
        body: '{{student}} got off {{bus}} at {{stop}} at {{time}}.',
        sms_body: null,
      },
      ta: {
        title: '{{student}} பேருந்திலிருந்து இறங்கினார்',
        body: '{{student}} {{time}} மணிக்கு {{stop}}-இல் {{bus}}-இலிருந்து இறங்கினார்.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.SOS_ALERT,
    category: 'alert',
    push: true,
    sms: 'always',
    critical: true,
    text: {
      en: {
        title: 'SOS from {{bus}}',
        body: '{{reporter}} raised an SOS on {{bus}} near {{location}} at {{time}}. Call {{phone}}.',
        sms_body:
          'SOS: {{reporter}} raised an alert on {{bus}} near {{location}} at {{time}}. Call {{phone}}. -TAMILZOROUS',
      },
      ta: {
        title: '{{bus}}-இலிருந்து அவசர அழைப்பு',
        body: '{{reporter}} {{time}} மணிக்கு {{location}} அருகே {{bus}}-இல் அவசர அழைப்பு விடுத்துள்ளார். {{phone}} எண்ணை அழைக்கவும்.',
        sms_body:
          'அவசரம்: {{reporter}} {{time}} மணிக்கு {{location}} அருகே {{bus}}-இல் அவசர அழைப்பு. {{phone}} எண்ணை அழைக்கவும். -TAMILZOROUS',
      },
    },
  },
  {
    code: TEMPLATES.SAFETY_ALERT,
    category: 'alert',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{kind}}: {{bus}}',
        body: '{{message}} on {{bus}} at {{time}}. See the alerts centre.',
        sms_body: null,
      },
      ta: {
        title: '{{kind}}: {{bus}}',
        body: '{{time}} மணிக்கு {{bus}}-இல் {{message}}. எச்சரிக்கை மையத்தில் பார்க்கவும்.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.SAFETY_ALERT_HIGH,
    category: 'alert',
    push: true,
    sms: 'fallback',
    critical: true,
    text: {
      en: {
        title: 'Urgent {{kind}}: {{bus}}',
        body: '{{message}} on {{bus}} at {{time}}. Check with the driver now.',
        sms_body: 'Urgent: {{message}} on {{bus}} at {{time}}. Check with the driver now. -TAMILZOROUS',
      },
      ta: {
        title: 'அவசர எச்சரிக்கை {{kind}}: {{bus}}',
        body: '{{time}} மணிக்கு {{bus}}-இல் {{message}}. உடனே ஓட்டுநரிடம் விசாரிக்கவும்.',
        sms_body: 'அவசரம்: {{time}} மணிக்கு {{bus}}-இல் {{message}}. உடனே ஓட்டுநரிடம் விசாரிக்கவும். -TAMILZOROUS',
      },
    },
  },
  {
    code: TEMPLATES.DIARY_POSTED,
    category: 'diary',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'New {{type}} for {{student}}',
        body: '{{teacher}} posted {{type}} in {{subject}}: {{title}}',
        sms_body: null,
      },
      ta: {
        title: '{{student}}-க்கு புதிய {{type}}',
        body: '{{teacher}} {{subject}} பாடத்தில் {{type}} பதிவிட்டுள்ளார்: {{title}}',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.MEETING_REMINDER,
    category: 'meeting',
    push: true,
    sms: 'fallback',
    critical: false,
    text: {
      en: {
        title: 'Meeting at {{time}}',
        body: 'Your meeting with {{host}} about {{student}} starts at {{time}}. Open the app to join.',
        sms_body:
          'Reminder: your meeting with {{host}} about {{student}} starts at {{time}}. Join from the app. -TAMILZOROUS',
      },
      ta: {
        title: '{{time}} மணிக்குக் கூட்டம்',
        body: '{{student}} குறித்து {{host}} உடனான உங்கள் கூட்டம் {{time}} மணிக்குத் தொடங்கும். இணைய செயலியைத் திறக்கவும்.',
        sms_body:
          'நினைவூட்டல்: {{student}} குறித்து {{host}} உடனான கூட்டம் {{time}} மணிக்குத் தொடங்கும். செயலியில் இணையவும். -TAMILZOROUS',
      },
    },
  },
  {
    code: TEMPLATES.MEETING_SCHEDULED,
    category: 'meeting',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'New meeting on {{time}}',
        body: '{{by}} booked a video meeting about {{student}} on {{time}}: {{title}}.',
        sms_body: null,
      },
      ta: {
        title: '{{time}} அன்று புதிய கூட்டம்',
        body: '{{student}} குறித்து {{by}} {{time}} அன்று வீடியோ கூட்டம் பதிவு செய்துள்ளார்: {{title}}.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.MEETING_CANCELLED,
    category: 'meeting',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Meeting cancelled',
        body: '{{by}} cancelled the meeting about {{student}} on {{time}}.{{reason}}',
        sms_body: null,
      },
      ta: {
        title: 'கூட்டம் ரத்து செய்யப்பட்டது',
        body: '{{time}} அன்று {{student}} குறித்த கூட்டத்தை {{by}} ரத்து செய்தார்.{{reason}}',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.MEETING_NOTES_SHARED,
    category: 'meeting',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Notes from your meeting about {{student}}',
        body: '{{host}} shared notes from the meeting "{{title}}". Open the meeting to read them.',
        sms_body: null,
      },
      ta: {
        title: '{{student}} குறித்த கூட்டக் குறிப்புகள்',
        body: '"{{title}}" கூட்டத்தின் குறிப்புகளை {{host}} பகிர்ந்துள்ளார். படிக்க கூட்டத்தைத் திறக்கவும்.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.MEETING_ENDING,
    category: 'meeting',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Meeting ends in {{minutes}} minutes',
        body: 'Your meeting with {{host}} about {{student}} is scheduled to end at {{time}}.',
        sms_body: null,
      },
      ta: {
        title: 'கூட்டம் {{minutes}} நிமிடங்களில் முடிவடையும்',
        body: '{{student}} குறித்து {{host}} உடனான உங்கள் கூட்டம் {{time}} மணிக்கு முடிவடைய உள்ளது.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.DIARY_REJECTED,
    category: 'diary',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Diary post sent back',
        body: '{{reviewer}} sent back your {{type}} "{{title}}".{{note}}',
        sms_body: null,
      },
      ta: {
        title: 'நாட்குறிப்பு பதிவு திருப்பி அனுப்பப்பட்டது',
        body: 'உங்கள் {{type}} "{{title}}" பதிவை {{reviewer}} திருப்பி அனுப்பினார்.{{note}}',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.ANNOUNCEMENT,
    category: 'announcement',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: { title: '{{title}}', body: '{{preview}}', sms_body: null },
      ta: { title: '{{title}}', body: '{{preview}}', sms_body: null },
    },
  },
  {
    code: TEMPLATES.ANNOUNCEMENT_URGENT,
    category: 'announcement',
    push: true,
    sms: 'fallback',
    critical: true,
    text: {
      en: {
        title: 'Urgent: {{title}}',
        body: '{{preview}}',
        sms_body: 'Urgent from {{school}}: {{title}}. Open the app for details. -TAMILZOROUS',
      },
      ta: {
        title: 'அவசரம்: {{title}}',
        body: '{{preview}}',
        sms_body: '{{school}} அவசர அறிவிப்பு: {{title}}. விவரங்களுக்கு செயலியைத் திறக்கவும். -TAMILZOROUS',
      },
    },
  },
  {
    code: TEMPLATES.CHAT_MESSAGE,
    category: 'chat',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: { title: '{{sender}}', body: '{{preview}}', sms_body: null },
      ta: { title: '{{sender}}', body: '{{preview}}', sms_body: null },
    },
  },
  {
    code: TEMPLATES.SUBSTITUTE_ASSIGNED,
    category: 'approval',
    push: true,
    sms: 'fallback',
    critical: false,
    text: {
      en: {
        title: 'Proxy class: {{section}}, period {{period}}',
        body: 'Please take {{subject}} for {{section}} in period {{period}} ({{time}}) on {{date}}, in place of {{absent}}.{{room}}',
        sms_body: 'Proxy: {{section}} period {{period}} ({{time}}) on {{date}} for {{absent}}. - {{school}}',
      },
      ta: {
        title: 'மாற்று வகுப்பு: {{section}}, பாடவேளை {{period}}',
        body: '{{date}} அன்று {{period}} ஆம் பாடவேளையில் ({{time}}) {{absent}} அவர்களுக்குப் பதிலாக {{section}} வகுப்பில் {{subject}} எடுக்கவும்.{{room}}',
        sms_body: 'மாற்று வகுப்பு: {{section}} பாடவேளை {{period}} ({{time}}) {{date}}, {{absent}} பதிலாக. - {{school}}',
      },
    },
  },
  {
    code: TEMPLATES.CLASS_COMBINED,
    category: 'approval',
    push: true,
    sms: 'fallback',
    critical: false,
    text: {
      en: {
        title: 'Combined class: {{from}} joins {{section}}, period {{period}}',
        body: '{{count}} {{group}} of {{from}} will sit in your {{section}} class in period {{period}} ({{time}}) on {{date}}, as {{absent}} is on leave.',
        sms_body:
          'Combined class: {{count}} {{group}} of {{from}} join {{section}} period {{period}} ({{time}}) on {{date}}. - {{school}}',
      },
      ta: {
        title: 'இணைந்த வகுப்பு: {{from}} → {{section}}, பாடவேளை {{period}}',
        body: '{{date}} அன்று {{period}} ஆம் பாடவேளையில் ({{time}}) {{absent}} விடுப்பில் இருப்பதால் {{from}} வகுப்பின் {{count}} {{group_ta}} உங்கள் {{section}} வகுப்பில் அமர்வார்கள்.',
        sms_body:
          'இணைந்த வகுப்பு: {{from}} {{count}} {{group_ta}} → {{section}} பாடவேளை {{period}} ({{time}}) {{date}}. - {{school}}',
      },
    },
  },
  {
    code: TEMPLATES.PAYSLIP_READY,
    category: 'account',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Payslip for {{month}} is ready',
        body: 'Your payslip for {{month}} is ready. Net pay {{net}}. Open the app to download it.',
        sms_body: null,
      },
      ta: {
        title: '{{month}} சம்பளச் சீட்டு தயார்',
        body: '{{month}} மாதத்திற்கான உங்கள் சம்பளச் சீட்டு தயார். நிகர ஊதியம் {{net}}. பதிவிறக்க ஆப்பைத் திறக்கவும்.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.FEE_DUE,
    category: 'fees',
    push: true,
    sms: 'fallback',
    critical: false,
    text: {
      en: {
        title: 'Fee due for {{student}}',
        body: '{{installment}} fee of {{amount}} for {{student}} is due on {{due_date}}. Open the app to see the details.',
        sms_body: 'Dear parent, {{installment}} fee of {{amount}} for {{student}} is due on {{due_date}}. -TAMILZOROUS',
      },
      ta: {
        title: '{{student}} கட்டணம் செலுத்த வேண்டும்',
        body: '{{student}}-க்கான {{installment}} கட்டணம் {{amount}}, {{due_date}} அன்றுக்குள் செலுத்த வேண்டும். விவரங்களுக்கு ஆப்பைத் திறக்கவும்.',
        sms_body:
          'அன்புள்ள பெற்றோரே, {{student}}-க்கான {{installment}} கட்டணம் {{amount}}, {{due_date}} அன்றுக்குள் செலுத்த வேண்டும். -TAMILZOROUS',
      },
    },
  },
  {
    code: TEMPLATES.FEE_OVERDUE,
    category: 'fees',
    push: true,
    sms: 'fallback',
    critical: false,
    text: {
      en: {
        title: 'Fee overdue for {{student}}',
        body: '{{amount}} for {{student}} was due on {{due_date}} and is still unpaid. Please pay at the school office.',
        sms_body: 'Dear parent, {{amount}} fee for {{student}} was due on {{due_date}} and is unpaid. -TAMILZOROUS',
      },
      ta: {
        title: '{{student}} கட்டணம் நிலுவையில் உள்ளது',
        body: '{{student}}-க்கான {{amount}} கட்டணம் {{due_date}} அன்று செலுத்த வேண்டியது, இன்னும் செலுத்தப்படவில்லை. பள்ளி அலுவலகத்தில் செலுத்தவும்.',
        sms_body:
          'அன்புள்ள பெற்றோரே, {{student}}-க்கான {{amount}} கட்டணம் {{due_date}} முதல் நிலுவையில் உள்ளது. -TAMILZOROUS',
      },
    },
  },
  {
    code: TEMPLATES.FLEET_DOCUMENT_EXPIRY,
    category: 'transport',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{document}} ends on {{date}}: {{subject}}',
        body: '{{document}} for {{subject}} is valid till {{date}} ({{days}} days left). Renew it to keep the bus on the road.',
        sms_body: null,
      },
      ta: {
        title: '{{document}} {{date}} அன்று முடிகிறது: {{subject}}',
        body: '{{subject}} க்கான {{document}} {{date}} வரை மட்டுமே செல்லும் ({{days}} நாட்கள் உள்ளன). பேருந்து இயங்க புதுப்பிக்கவும்.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.ACHIEVEMENT_ADDED,
    category: 'system',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Well done, {{student}}!',
        body: '{{student}}: {{title}} ({{level}} level){{position}}.',
        sms_body: null,
      },
      ta: {
        title: 'வாழ்த்துகள், {{student}}!',
        body: '{{student}}: {{title}} ({{level}} அளவில்){{position}}.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.TRIP_NOT_BOARDED,
    category: 'transport',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{count}} from {{section}} did not board the bus',
        body: 'Not on {{bus}} this morning: {{names}}. Please check before the first period.',
        sms_body: null,
      },
      ta: {
        title: '{{section}} வகுப்பில் {{count}} பேர் பேருந்தில் ஏறவில்லை',
        body: 'இன்று காலை {{bus}} பேருந்தில் இல்லை: {{names}}. முதல் பாடவேளைக்கு முன் சரிபார்க்கவும்.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.RESULT_PUBLISHED,
    category: 'system',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: '{{exam}} results: {{student}}',
        body: '{{student}} scored {{percent}}% (grade {{grade}}) in the {{exam}}. Class rank {{rank}}. Open the app for subject marks.',
        sms_body: null,
      },
      ta: {
        title: '{{exam}} முடிவுகள்: {{student}}',
        body: '{{exam}} தேர்வில் {{student}} {{percent}}% மதிப்பெண் (தரம் {{grade}}) பெற்றுள்ளார். வகுப்பு தரவரிசை {{rank}}. பாட வாரியான மதிப்பெண்களுக்கு செயலியைத் திறக்கவும்.',
        sms_body: null,
      },
    },
  },
  {
    code: TEMPLATES.VEHICLE_FAULT,
    category: 'transport',
    push: true,
    sms: 'never',
    critical: false,
    text: {
      en: {
        title: 'Engine fault on {{bus}}: {{code}}',
        body: '{{bus}} reported fault {{code}} ({{fault}}), severity {{severity}}. A maintenance ticket is open in Fleet maintenance.',
        sms_body: null,
      },
      ta: {
        title: '{{bus}} பேருந்தில் என்ஜின் கோளாறு: {{code}}',
        body: '{{bus}} பேருந்தில் {{code}} ({{fault}}) கோளாறு கண்டறியப்பட்டது, தீவிரம்: {{severity}}. பராமரிப்பு பகுதியில் ஒரு டிக்கெட் திறக்கப்பட்டுள்ளது.',
        sms_body: null,
      },
    },
  },
];
