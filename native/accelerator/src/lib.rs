pub fn normalize_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::normalize_whitespace;

    #[test]
    fn normalizes_whitespace() {
        assert_eq!(normalize_whitespace("a\n  b\t c"), "a b c");
    }
}

