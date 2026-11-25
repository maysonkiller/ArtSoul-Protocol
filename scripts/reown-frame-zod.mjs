import { any, array, boolean, email, enum as enumeration, literal, number, object, optional, record, string } from 'zod';

// Public constructors used by the reviewed Reown frame. Under Zod 3 a named
// field declared as any() could be absent from an otherwise valid message.
export const z = {
    array, boolean, enum: enumeration, literal, number, object, optional, record,
    any: () => any().optional(),
    string() {
        const field = string();
        // The frame has always required this narrower email grammar.
        field.email = () => email().refine(value => !value.includes("'"));
        return field;
    }
};
