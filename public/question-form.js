import { renderPreview } from "./previews.js";
const $ = (id) => document.getElementById(id);
export function showQuestions(request, send) {
    const container = $("questions-container");
    container.replaceChildren();
    container.classList.toggle("batch", request.questions.length > 1);
    $("request-meta").textContent =
        `Actual tool-use ID: ${request.toolUseID} · deadline: ${new Date(request.deadline).toLocaleTimeString()}`;
    $("question-status").textContent =
        "The SDK is waiting for your answers. Nothing is selected or submitted automatically.";
    request.questions.forEach((q, index) => {
        const field = document.createElement("fieldset");
        field.className = "question-card";
        field.id = "question-" + index;
        const legend = document.createElement("legend");
        legend.textContent = q.header;
        field.append(legend);
        const text = document.createElement("p");
        text.className = "question-text";
        text.textContent = q.question;
        field.append(text);
        const hint = document.createElement("p");
        hint.className = "meta";
        hint.textContent = q.multiSelect
            ? "Choose one or more options."
            : "Choose one option.";
        field.append(hint);
        const grid = document.createElement("div");
        grid.className = "option-grid";
        field.append(grid);
        const custom = document.createElement("textarea");
        custom.className = "other-text";
        custom.placeholder = "Type your own answer";
        custom.maxLength = 500;
        custom.hidden = true;
        custom.setAttribute("aria-label", "Your custom answer to " + q.question);
        q.options.forEach((option, optionIndex) => {
            const card = document.createElement("article");
            card.className = "question-option";
            const label = document.createElement("label");
            label.className = "option-choice";
            const input = document.createElement("input");
            input.type = q.multiSelect ? "checkbox" : "radio";
            input.name = "q-" + index;
            input.value = option.label;
            input.id = `q-${index}-option-${optionIndex}`;
            input.onchange = () => {
                if (input.checked) {
                    field.querySelector("[data-custom]").checked =
                        false;
                    custom.hidden = true;
                }
            };
            const words = document.createElement("span");
            const title = document.createElement("strong");
            title.textContent = option.label;
            const description = document.createElement("span");
            description.className = "option-description";
            description.textContent = option.description;
            words.append(title, description);
            label.append(input, words);
            card.append(label);
            if (request.previewFormat !== "none") {
                const preview = document.createElement("div");
                preview.className = "option-preview";
                renderPreview(preview, option.preview, request.previewFormat, option.label);
                card.append(preview);
            }
            grid.append(card);
        });
        const other = document.createElement("label");
        other.className = "other-choice";
        const check = document.createElement("input");
        check.type = q.multiSelect ? "checkbox" : "radio";
        check.name = "q-" + index;
        check.dataset.custom = "true";
        check.onchange = () => {
            custom.hidden = !check.checked;
            if (check.checked) {
                field
                    .querySelectorAll("input:not([data-custom])")
                    .forEach((i) => (i.checked = false));
                custom.focus();
            }
        };
        other.append(check, document.createTextNode("Other · use my own words"));
        field.append(other, custom);
        container.append(field);
    });
    const form = $("question-form");
    form.onsubmit = (event) => {
        event.preventDefault();
        const selections = Object.create(null);
        request.questions.forEach((q, index) => {
            const field = $("question-" + index), other = field.querySelector("[data-custom]").checked;
            selections[q.question] = other
                ? {
                    labels: [],
                    other: field.querySelector(".other-text").value,
                }
                : {
                    labels: [
                        ...field.querySelectorAll("input:not([data-custom]):checked"),
                    ].map((i) => i.value),
                };
        });
        void send({ kind: "answers", selections });
    };
    $("cancel-question").onclick = () => void send({ kind: "cancel" });
    $("send-response").onclick = () => void send({
        kind: "response",
        response: $("general-response").value,
    });
    form
        .querySelectorAll("button")
        .forEach((b) => (b.disabled = false));
    $("send-response").disabled = false;
}
