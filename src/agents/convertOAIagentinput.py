from hermes.types import UserMessage, SystemMessage, AssistantMessage

def _convert_oai_messages_to_agent_input(self, messages):
    """
    Convert OpenAI-style messages into hermes-agent message objects.

    OpenAI format:
        {"role": "system"|"user"|"assistant", "content": "..."}

    Hermes-agent format:
        SystemMessage(content)
        UserMessage(content)
        AssistantMessage(content)

    The final message MUST be a UserMessage (the user's latest input).
    Everything before it becomes conversation history.
    """

    system_prompt = None
    history = []
    final_user_message = None

    for msg in messages:
        role = msg.get("role")
        content = msg.get("content", "")

        if role == "system":
            # Only one system message is allowed; last one wins
            system_prompt = SystemMessage(content)

        elif role == "assistant":
            history.append(AssistantMessage(content))

        elif role == "user":
            # The last user message is the actual query
            if final_user_message is not None:
                # previous user messages become history
                history.append(UserMessage(final_user_message.content))
            final_user_message = UserMessage(content)

        else:
            raise ValueError(f"Unknown role: {role}")

    if final_user_message is None:
        raise ValueError("OpenAI messages must include at least one user message")

    return {
        "system": system_prompt,
        "history": history,
        "message": final_user_message,
    }
