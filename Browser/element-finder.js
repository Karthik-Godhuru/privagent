function findInteractiveElements() {
    const elements = document.querySelectorAll(
        "button, input, select, textarea, a"
    );

    return Array.from(elements).map((element, index) => ({
        id: `element_${index}`,
        type: element.tagName.toLowerCase(),
        label:
            element.innerText ||
            element.getAttribute("aria-label") ||
            element.getAttribute("placeholder") ||
            element.value ||
            ""
    }));
}

module.exports = {
    findInteractiveElements
};
