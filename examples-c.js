/* =====================================================================
   examples-c.js  -  the C gallery (same idea as examples.js)
   Each example needs:  id, title, tags, blurb, code   (lang is set below)
   Keep every example within 30 lines and inside what ctracer.js understands.
   ===================================================================== */
(function () {
  const C_EXAMPLES = [
    {
      id: "c-hello-variables",
      title: "Variables & printf",
      tags: ["int", "float", "char", "printf"],
      blurb: "Create variables of different types and print them.",
      code: [
        '#include <stdio.h>',
        '',
        'int main() {',
        '    int age = 18;',
        '    float height = 1.75;',
        '    char grade = \'A\';',
        '    printf("Age: %d\\n", age);',
        '    printf("Height: %.2f\\n", height);',
        '    printf("Grade: %c\\n", grade);',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-sum-array",
      title: "Sum of numbers",
      tags: ["array", "for"],
      blurb: "Add up every item of an array with a for loop.",
      code: [
        '#include <stdio.h>',
        '',
        'int main() {',
        '    int nums[4] = {4, 8, 15, 16};',
        '    int total = 0;',
        '    for (int i = 0; i < 4; i++) {',
        '        total = total + nums[i];',
        '    }',
        '    printf("Total = %d\\n", total);',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-even-odd",
      title: "Even or odd?",
      tags: ["if", "else", "%"],
      blurb: "Use % (remainder) to choose a branch.",
      code: [
        '#include <stdio.h>',
        '',
        'int main() {',
        '    int number = 7;',
        '    if (number % 2 == 0) {',
        '        printf("%d is even\\n", number);',
        '    } else {',
        '        printf("%d is odd\\n", number);',
        '    }',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-print-1-to-5",
      title: "Print 1 to 5",
      tags: ["for"],
      blurb: "The classic for loop: start, check, update.",
      code: [
        '#include <stdio.h>',
        '',
        'int main() {',
        '    for (int i = 1; i <= 5; i++) {',
        '        printf("%d\\n", i);',
        '    }',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-countdown",
      title: "Countdown (do-while)",
      tags: ["do-while"],
      blurb: "A do-while loop always runs its body at least once.",
      code: [
        '#include <stdio.h>',
        '',
        'int main() {',
        '    int count = 3;',
        '    do {',
        '        printf("%d\\n", count);',
        '        count--;',
        '    } while (count > 0);',
        '    printf("Liftoff!\\n");',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-factorial-loop",
      title: "Factorial (loop)",
      tags: ["for", "int"],
      blurb: "Multiply 1 x 2 x 3 x 4 x 5 step by step.",
      code: [
        '#include <stdio.h>',
        '',
        'int main() {',
        '    int n = 5;',
        '    int result = 1;',
        '    for (int i = 1; i <= n; i++) {',
        '        result *= i;',
        '    }',
        '    printf("%d! = %d\\n", n, result);',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-factorial-recursion",
      title: "Factorial (recursion)",
      tags: ["function", "return", "call stack"],
      blurb: "Watch a function call itself and the call stack grow.",
      code: [
        '#include <stdio.h>',
        '',
        'int factorial(int n) {',
        '    if (n <= 1) {',
        '        return 1;',
        '    }',
        '    return n * factorial(n - 1);',
        '}',
        '',
        'int main() {',
        '    int answer = factorial(4);',
        '    printf("%d\\n", answer);',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-fibonacci",
      title: "Fibonacci",
      tags: ["for", "int"],
      blurb: "Each number is the sum of the two before it.",
      code: [
        '#include <stdio.h>',
        '',
        'int main() {',
        '    int a = 0, b = 1, next;',
        '    for (int i = 0; i < 7; i++) {',
        '        printf("%d ", a);',
        '        next = a + b;',
        '        a = b;',
        '        b = next;',
        '    }',
        '    printf("\\n");',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-max",
      title: "Find the biggest",
      tags: ["array", "if"],
      blurb: "Keep the best score seen so far.",
      code: [
        '#include <stdio.h>',
        '',
        'int main() {',
        '    int scores[4] = {62, 91, 45, 78};',
        '    int best = scores[0];',
        '    for (int i = 1; i < 4; i++) {',
        '        if (scores[i] > best) {',
        '            best = scores[i];',
        '        }',
        '    }',
        '    printf("Highest: %d\\n", best);',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-linear-search",
      title: "Linear search",
      tags: ["array", "break"],
      blurb: "Look at items one by one until the target is found.",
      code: [
        '#include <stdio.h>',
        '',
        'int main() {',
        '    int items[5] = {9, 4, 7, 2, 5};',
        '    int target = 7;',
        '    int found = -1;',
        '    for (int i = 0; i < 5; i++) {',
        '        if (items[i] == target) {',
        '            found = i;',
        '            break;',
        '        }',
        '    }',
        '    printf("Found at index %d\\n", found);',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-binary-search",
      title: "Binary search",
      tags: ["while", "array"],
      blurb: "Halve the search area every step.",
      code: [
        '#include <stdio.h>',
        '',
        'int main() {',
        '    int data[7] = {2, 5, 8, 12, 16, 23, 38};',
        '    int target = 23;',
        '    int low = 0, high = 6, found = -1;',
        '    while (low <= high) {',
        '        int mid = (low + high) / 2;',
        '        if (data[mid] == target) {',
        '            found = mid;',
        '            break;',
        '        } else if (data[mid] < target) {',
        '            low = mid + 1;',
        '        } else {',
        '            high = mid - 1;',
        '        }',
        '    }',
        '    printf("Found at %d\\n", found);',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-bubble-sort",
      title: "Bubble sort",
      tags: ["array", "nested loops"],
      blurb: "Swap neighbours until the array is in order.",
      code: [
        '#include <stdio.h>',
        '',
        'int main() {',
        '    int nums[5] = {5, 2, 9, 1, 6};',
        '    for (int i = 0; i < 4; i++) {',
        '        for (int j = 0; j < 4 - i; j++) {',
        '            if (nums[j] > nums[j + 1]) {',
        '                int temp = nums[j];',
        '                nums[j] = nums[j + 1];',
        '                nums[j + 1] = temp;',
        '            }',
        '        }',
        '    }',
        '    for (int k = 0; k < 5; k++) printf("%d ", nums[k]);',
        '    printf("\\n");',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-prime",
      title: "Prime numbers",
      tags: ["function", "for", "return"],
      blurb: "A function that tests numbers 2 to 7 for primes.",
      code: [
        '#include <stdio.h>',
        '',
        'int is_prime(int n) {',
        '    if (n < 2) return 0;',
        '    for (int i = 2; i < n; i++) {',
        '        if (n % i == 0) return 0;',
        '    }',
        '    return 1;',
        '}',
        '',
        'int main() {',
        '    for (int num = 2; num <= 7; num++) {',
        '        printf("%d -> %d\\n", num, is_prime(num));',
        '    }',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-gcd",
      title: "GCD (Euclid)",
      tags: ["while", "function"],
      blurb: "Find the greatest common divisor with remainders.",
      code: [
        '#include <stdio.h>',
        '',
        'int gcd(int a, int b) {',
        '    while (b != 0) {',
        '        int r = a % b;',
        '        a = b;',
        '        b = r;',
        '    }',
        '    return a;',
        '}',
        '',
        'int main() {',
        '    printf("%d\\n", gcd(48, 18));',
        '    return 0;',
        '}'
      ].join("\n")
    },
    {
      id: "c-reverse-string",
      title: "Reverse a string",
      tags: ["char array", "strlen"],
      blurb: "Swap letters from both ends of a char array.",
      code: [
        '#include <stdio.h>',
        '#include <string.h>',
        '',
        'int main() {',
        '    char word[] = "python";',
        '    int left = 0;',
        '    int right = strlen(word) - 1;',
        '    while (left < right) {',
        '        char t = word[left];',
        '        word[left] = word[right];',
        '        word[right] = t;',
        '        left++;',
        '        right--;',
        '    }',
        '    printf("%s\\n", word);',
        '    return 0;',
        '}'
      ].join("\n")
    }
  ];
  window.CODEFLIX_EXAMPLES = (window.CODEFLIX_EXAMPLES || []).concat(C_EXAMPLES.map((e) => Object.assign({ lang: "c" }, e)));
})();
