// RAG --> Retrieval Augmented Generation

/*

Problem Statement: Create a Chatbot as your girlfiend

- system configure / context --> behave as my girlfriend

- What my gf likes to wear?
- What my gf likes to eat?

==> It won't be able to answer these questions because it doesn't have any context about your girlfriend. It will halucinate and give random answers.

What is Hallucination?

- It is a phenomenon where the model generates information that is not based on the input or context. Like even if you don't know the answer of a question in your exam, you will write something random -- In a hope to get marks. This is called hallucination in AI.

What is fine-tuning?

- Fine-tuning is the process of taking a pre-trained model and training it further on a specific dataset to make it more suitable for a particular task. In this case, you would fine-tune the model on a dataset that contains information about your girlfriend's preferences, interests, and personality traits
so that it can generate more accurate and relevant responses.

-- But fine-tuning is not always the best solution because:

- It requires a lot of data about your girlfriend.
- It requires a lot of computational resources.
- It is time-consuming and expensive. (Uses a lot of Tokens which costs money)

How to solve this problem?

- Use RAG (Retrieval Augmented Generation) to provide context to the model.



*/