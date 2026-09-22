function navigateTo(url) {
    if (!url || !/^https?:\/\//i.test(url)) {
        throw new Error("Invalid navigation URL");
    }

    window.location.href = url;

    return {
        success: true,
        url
    };
}

module.exports = {
    navigateTo
};
