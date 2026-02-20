# {{name}}

{{#if professional_profile}}
## Professional Profile
{{professional_profile}}

{{/if}}
{{#if skills}}
## Core Skills
{{#each skills}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}

{{/if}}
{{#if experience}}
## Professional Experience
{{#each experience}}
### {{job_title}} | {{company}}
📍 {{location}} | 🗓 {{start_date}} – {{end_date}}

{{#each achievements}}
* {{this}}
{{/each}}

{{/each}}
{{/if}}
{{#if education}}
## Education
{{#each education}}
### {{degree}} | {{institution}}
📍 {{location}} | 🗓 {{graduation_date}}
{{/each}}

{{/if}}
{{#if certifications}}
## Certifications
{{#each certifications}}
* **{{name}}** - {{issuer}} ({{date}})
{{/each}}

{{/if}}
{{#if projects}}
## Projects
{{#each projects}}
### {{name}}
{{description}}

**Technologies:** {{#each technologies}}{{this}}{{#unless @last}}, {{/unless}}{{/each}}
{{/each}}

{{/if}}
{{#if (hasKeys additional_info)}}
## Additional Information
{{#each additional_info}}
* **{{@key}}:** {{this}}
{{/each}}
{{/if}}