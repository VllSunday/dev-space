# Примеры ответов Linear

Ответы составлены по публичной документации GraphQL API Linear
(<https://linear.app/developers/graphql>) и повторяют её форму: `data.issues.nodes`,
`data.workflowStates.nodes`, `data.issueUpdate`, `data.commentCreate`. Это не запись обмена с
настоящим аккаунтом: ключа Linear у проверки нет. Плагин на этих примерах проверяет разбор ответа,
подстановку ключа и адреса, смену статуса через поиск состояния и поведение при ошибке сервиса.
