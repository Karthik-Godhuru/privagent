function isVisible(element) {

  const style =
    window.getComputedStyle(element);

  const rectangle =
    element.getBoundingClientRect();

  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    rectangle.width > 0 &&
    rectangle.height > 0
  );
}


function extractPageInformation() {

  const buttons =
    Array.from(
      document.querySelectorAll("button")
    )
      .filter(isVisible)
      .map((button) => ({
        text:
          button.innerText.trim(),

        id:
          button.id || "",

        disabled:
          button.disabled
      }));


  const inputs =
    Array.from(
      document.querySelectorAll(
        "input, textarea, select"
      )
    )
      .filter(isVisible)
      .map((element) => ({
        tag:
          element.tagName.toLowerCase(),

        type:
          element.type || "",

        id:
          element.id || "",

        name:
          element.name || "",

        placeholder:
          element.placeholder || "",

        ariaLabel:
          element.getAttribute(
            "aria-label"
          ) || "",

        value:
          element.value || ""
      }));


  const links =
    Array.from(
      document.querySelectorAll("a")
    )
      .filter(isVisible)
      .map((link) => ({
        text:
          link.innerText.trim(),

        href:
          link.href
      }));


  return {

    pageTitle:
      document.title,

    url:
      window.location.href,

    buttons,

    inputs,

    links,

    visibleText:
      document.body.innerText
        .replace(/\s+/g, " ")
        .trim()
        .substring(0, 5000)
  };
}


chrome.runtime.onMessage.addListener(
  (request, sender, sendResponse) => {

    if (
      request.type ===
      "EXTRACT_PAGE"
    ) {

      const pageInformation =
        extractPageInformation();

      sendResponse(pageInformation);
    }
  }
);