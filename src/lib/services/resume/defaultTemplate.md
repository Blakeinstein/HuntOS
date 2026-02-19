# {{name}}

## Professional Profile
{{professional_profile}}

## Core Skills
{{#each skills}}
- {{this}}
{{/each}}

## Professional Experience
{{#each experience}}
### {{job_title}} | {{company}}
📍 {{location}} | 🗓 {{start_date}} – {{end_date}}

{{#each achievements}}
* {{this}}
{{/each}}

{{/each}}

## Education
{{#each education}}
### {{degree}} | {{institution}}
📍 {{location}} | 🗓 {{graduation_date}}
{{/each}}

## Certifications
{{#each certifications}}
* **{{name}}** - {{issuer}} ({{date}})
{{/each}}

## Projects
{{#each projects}}
### {{name}}
{{description}}

**Technologies:** {{#each technologies}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
{{/each}}

## Additional Information
{{#each additional_info}}
* **{{@key}}:** {{this}}
{{/each}}